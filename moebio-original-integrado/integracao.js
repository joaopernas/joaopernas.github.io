(() => {
  'use strict';

  const canvas = document.getElementById('space-canvas');
  const ctx = canvas.getContext('2d');
  const space = document.getElementById('space');
  const treeHost = document.getElementById('tree-host');
  const select = document.getElementById('prompt-select');
  const slider = document.getElementById('temperature');
  const temperatureOutput = document.getElementById('temperature-output');
  const didacticToggle = document.getElementById('didactic-toggle');
  const restart = document.getElementById('restart');
  const sentence = document.getElementById('sentence');
  const metricToken = document.getElementById('metric-token');
  const metricProbability = document.getElementById('metric-probability');
  const metricPosition = document.getElementById('metric-position');
  const contextValue = document.getElementById('context-value');
  const treeStats = document.getElementById('tree-stats');
  const status = document.getElementById('status');
  const help = document.getElementById('help');
  const helpButton = document.getElementById('help-button');
  const helpClose = document.getElementById('help-close');
  const helpContent = document.getElementById('help-content');

  const systemFont = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
  const semanticColors = ['#18aeb5','#2e78b7','#5b79c7','#9b78d1','#d26f9b','#d98b4b','#e5b84b','#57b892'];
  let temperature = 1.6;
  let treeTile = null;
  let masterTree = null;
  let focusNode = null;
  let width = 1, height = 1, dpr = 1;
  let points = [], paths = [], selected = null, hovered = null;
  let rotationX = -.22, rotationY = .52, targetX = rotationX, targetY = rotationY, zoom = .95;
  let dragging = false, dragX = 0, dragY = 0, autoRotate = true, lastFrame = performance.now();
  let loadSequence = 0;

  window.TEXTS_OBJECT = [];
  window.simplifyTree = false;
  window.treeView = null;
  window.W = 1.8; window.H = 1.7; window.D = 1.8;
  window.Wh = .9; window.Hh = .85; window.Dh = .9;

  function rgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${value >> 16},${value >> 8 & 255},${value & 255},${alpha})`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
  }

  function nodeProbability(node) {
    return node?.parent ? node.weight / Math.max(1, node.parent.weight) : 1;
  }

  function updateMetrics(node) {
    if (!node?.object?.pca) return;
    const parts = node.id.split(' ');
    const last = parts.pop() || node.name;
    sentence.innerHTML = `${escapeHtml(parts.join(' '))}${parts.length ? ' ' : ''}<mark>${escapeHtml(last)}</mark>`;
    metricToken.textContent = node.name;
    metricProbability.textContent = `${(nodeProbability(node) * 100).toFixed(nodeProbability(node) < .1 ? 2 : 1).replace('.', ',')}%`;
    const pca = node.object.pca;
    metricPosition.textContent = `[${pca.x.toFixed(2)}, ${pca.y.toFixed(2)}, ${pca.z.toFixed(2)}]`.replaceAll('.', ',');
  }

  function cloneFocusTree(root) {
    const view = new _.Tr();
    let total = 0;
    const maxNodes = 4800;
    const clone = (source, parent) => {
      if (total >= maxNodes) return null;
      const node = new _.Nd(source.id, source.name);
      node.object = source.object;
      node.sourceId = source.id;
      node.nDown = source.nDown || 1;
      node.color = 'rgba(31,59,91,.98)';
      view.addNodeToTree(node, parent);
      total++;
      const ordered = [...source.to].sort((a,b) => b.weight - a.weight);
      let children = ordered;
      if (temperature <= .02) children = ordered.slice(0,1);
      else if (temperature < .4) children = ordered.slice(0,Math.min(3,ordered.length));
      else if (temperature < .9) children = ordered.slice(0,Math.min(7,ordered.length));
      children.forEach(child => clone(child,node));
      return node;
    };
    clone(root,null);
    view.assignDescentWeightsToNodes();
    return view;
  }

  function sendTree() {
    if (!masterTree || !focusNode) return;
    const viewTree = cloneFocusTree(focusNode);
    treeStats.textContent = `${viewTree.nodes.length} blocos · nível ${focusNode.level}`;
    contextValue.textContent = focusNode.id;
    if (!treeTile?.loaded) return;
    treeTile.sendData({type:'background_color',value:'#000000'});
    treeTile.sendData({type:'nodes_color',value:'rgba(31,59,91,.98)'});
    treeTile.sendData({type:'text_color',value:'#ffffff'});
    treeTile.sendData({type:'data',value:viewTree});
  }

  function handleTreeMessage(event) {
    const data = event.data;
    if (!data || !masterTree) return;
    if (data.type === 'selected' && data.value?.id) {
      const node = masterTree.get(data.value.id);
      if (node) { focusNode = node; selected = node; updateMetrics(node); sendTree(); buildPaths(); }
    } else if (data.type === 'over' && data.value?.id) {
      const node = masterTree.get(data.value.id);
      if (node) { hovered = node; updateMetrics(node); }
    } else if (data.type === 'out') {
      hovered = null;
      updateMetrics(selected || focusNode);
    }
  }

  function layoutTile() {
    if (!treeTile) return;
    const rect = treeHost.getBoundingClientRect();
    const heading = window.innerWidth <= 560 ? 70 : 60;
    treeTile.setDimensions(rect.left, rect.top + heading, rect.width, Math.max(1, rect.height - heading), 5);
    treeTile.iframe.title = 'Árvore probabilística interativa de tokens';
  }

  function startTreeTile() {
    treeTile = loadTile('./Pulse_And_Tiles/Tiles/Tree', tile => {
      treeTile = tile;
      layoutTile();
      sendTree();
    }, handleTreeMessage, 'Árvore probabilística', true);
    layoutTile();
  }

  function buildPaths() {
    if (!masterTree) return;
    points = masterTree.nodes.filter(node => node.object?.pca);
    const descendants = [];
    const collect = node => { if (!node.to.length) descendants.push(node); else node.to.forEach(collect); };
    collect(focusNode || masterTree.nodes[0]);
    paths = descendants.slice(0,420).map(leaf => {
      const chain = [];
      let node = leaf;
      while (node) { if (node.object?.pca) chain.unshift(node); node = node.parent; }
      return chain;
    });
    selected = focusNode || points[0];
    updateMetrics(selected);
  }

  async function loadDataset() {
    const sequence = ++loadSequence;
    status.hidden = false;
    status.textContent = 'A carregar os dados reais…';
    const response = await fetch(`./data/${select.value}`);
    if (!response.ok) throw new Error(`Falha ao carregar data/${select.value}: HTTP ${response.status}`);
    const data = await response.json();
    if (sequence !== loadSequence) return;
    window.TEXTS_OBJECT = data;
    window.treeView = null;
    status.textContent = `A construir a árvore com ${data.length.toLocaleString('pt-PT')} registos…`;
    await new Promise(resolve => setTimeout(resolve,20));
    buildTree();
    masterTree = window.tree;
    masterTree.assignDescentWeightsToNodes();
    focusNode = masterTree.nodes[0];
    status.textContent = 'A calcular a projeção PCA a partir dos embeddings…';
    await new Promise(resolve => setTimeout(resolve,20));
    calculatePCAs(true);
    buildPaths();
    sendTree();
    status.hidden = true;
  }

  function normalizeHelp(raw) {
    return raw
      .replace(/<fcWhite>/gi,'').replace(/<fs\d+>/gi,'').replace(/<\/f>/gi,'')
      .replace(/<a href="javascript:[^"]*"[^>]*>(.*?)<\/a>/gis,'<span class="help-link">$1</span>')
      .replace(/<b>(.*?)<\/b>/gis,'<strong>$1</strong>')
      .replace(/\n\s*\n/g,'<br><br>')
      .replace(/\n/g,'<br>');
  }

  async function loadHelp() {
    try {
      const response = await fetch('./Help.pt.txt');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      const area = new HtmlArea(() => {}, {});
      area.div.remove();
      helpContent.innerHTML = normalizeHelp(raw);
    } catch (error) {
      helpContent.textContent = `Não foi possível carregar a ajuda: ${error.message}`;
    }
  }

  function resizeCanvas() {
    const rect = space.getBoundingClientRect();
    width = Math.max(1,rect.width); height = Math.max(1,rect.height); dpr = Math.min(devicePixelRatio || 1,2);
    canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr); ctx.setTransform(dpr,0,0,dpr,0,0);
    layoutTile();
  }

  function rotate(point) {
    const cy=Math.cos(rotationY),sy=Math.sin(rotationY),cx=Math.cos(rotationX),sx=Math.sin(rotationX);
    const x=point.x*cy-point.z*sy,z=point.x*sy+point.z*cy;
    return {x,y:point.y*cx-z*sx,z:point.y*sx+z*cx};
  }

  function projectPca(pca) {
    const rotated = rotate(pca);
    const base = Math.min(width*.82,height*.82)*zoom;
    const perspective = 3/(3.25+rotated.z);
    return {x:width*.52+rotated.x*base*.55*perspective,y:height*.52-rotated.y*base*.58*perspective,z:rotated.z,scale:perspective};
  }

  function drawCube() {
    const corners=[[-.92,-.86,-.9],[.92,-.86,-.9],[.92,.86,-.9],[-.92,.86,-.9],[-.92,-.86,.9],[.92,-.86,.9],[.92,.86,.9],[-.92,.86,.9]].map(([x,y,z])=>projectPca({x,y,z}));
    const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    ctx.lineWidth=.7;
    edges.forEach(([a,b],index)=>{ctx.strokeStyle=index%3?'rgba(46,120,183,.22)':'rgba(24,174,181,.4)';ctx.beginPath();ctx.moveTo(corners[a].x,corners[a].y);ctx.lineTo(corners[b].x,corners[b].y);ctx.stroke();});
  }

  function isDescendant(node, ancestor) {
    let current=node;
    while(current){if(current===ancestor)return true;current=current.parent;}
    return false;
  }

  function drawPoints() {
    const focus=focusNode;
    points.map((node,index)=>({node,index,p:projectPca(node.object.pca)})).sort((a,b)=>b.p.z-a.p.z).forEach(({node,index,p})=>{
      const related=!focus||isDescendant(node,focus)||isDescendant(focus,node);
      const color=semanticColors[node.level%semanticColors.length];
      ctx.fillStyle=rgba(color,related?.58:.08);ctx.beginPath();ctx.arc(p.x,p.y,(related?1.25:.6)*p.scale,0,Math.PI*2);ctx.fill();
    });
  }

  function drawPaths() {
    paths.forEach((path,index)=>{
      const color=semanticColors[index%semanticColors.length];
      const projected=path.map(node=>projectPca(node.object.pca));
      ctx.strokeStyle=rgba(color,index<30?.25:.07);ctx.lineWidth=index<16?.65:.3;ctx.beginPath();projected.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
    });
    const node=hovered||selected;
    if(node?.object?.pca){const p=projectPca(node.object.pca);ctx.fillStyle='#e5b84b';ctx.beginPath();ctx.arc(p.x,p.y,5*p.scale,0,Math.PI*2);ctx.fill();}
  }

  function render(now) {
    const delta=Math.min(32,now-lastFrame);lastFrame=now;
    if(!dragging){rotationX+=(targetX-rotationX)*.08;rotationY+=(targetY-rotationY)*.08;if(autoRotate&&!matchMedia('(prefers-reduced-motion: reduce)').matches)targetY+=delta*.000015;}
    ctx.clearRect(0,0,width,height);drawCube();drawPoints();drawPaths();requestAnimationFrame(render);
  }

  function nearest(event) {
    const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;let result=null,distance=12;
    points.slice(0,1600).forEach(node=>{const p=projectPca(node.object.pca),d=Math.hypot(p.x-x,p.y-y);if(d<distance){distance=d;result=node;}});return result;
  }

  canvas.addEventListener('pointerdown',event=>{dragging=true;autoRotate=false;dragX=event.clientX;dragY=event.clientY;canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(dragging){targetY+=(event.clientX-dragX)*.006;targetX=Math.max(-1.3,Math.min(1.3,targetX+(event.clientY-dragY)*.006));dragX=event.clientX;dragY=event.clientY;return;}const node=nearest(event);if(node!==hovered){hovered=node;canvas.style.cursor=node?'pointer':'grab';updateMetrics(node||selected);}});
  canvas.addEventListener('pointerup',event=>{const node=nearest(event);if(node){focusNode=node;selected=node;sendTree();buildPaths();}dragging=false;});
  canvas.addEventListener('pointerleave',()=>{dragging=false;hovered=null;updateMetrics(selected||focusNode);});
  canvas.addEventListener('wheel',event=>{event.preventDefault();zoom=Math.max(.55,Math.min(1.6,zoom-event.deltaY*.00075));},{passive:false});

  select.addEventListener('change',()=>{autoRotate=true;loadDataset().catch(showError);});
  restart.addEventListener('click',()=>{if(masterTree){focusNode=masterTree.nodes[0];selected=focusNode;sendTree();buildPaths();}});
  slider.addEventListener('input',()=>{temperature=Number(slider.value);temperatureOutput.textContent=temperature.toFixed(2).replace('.',',');document.querySelectorAll('[data-temperature]').forEach(button=>button.classList.toggle('active',Math.abs(Number(button.dataset.temperature)-temperature)<.01));sendTree();});
  document.querySelectorAll('[data-temperature]').forEach(button=>button.addEventListener('click',()=>{slider.value=button.dataset.temperature;slider.dispatchEvent(new Event('input'));}));
  didacticToggle.addEventListener('click',()=>{const active=didacticToggle.getAttribute('aria-pressed')!=='true';didacticToggle.setAttribute('aria-pressed',String(active));didacticToggle.textContent=`Didático: ${active?'ligado':'desligado'}`;document.querySelectorAll('.didactic-content').forEach(element=>element.hidden=!active);});
  helpButton.addEventListener('click',()=>help.classList.add('open'));
  helpClose.addEventListener('click',()=>help.classList.remove('open'));
  help.addEventListener('click',event=>{if(event.target===help)help.classList.remove('open');});

  function showError(error){console.error(error);status.hidden=false;status.textContent=`Erro: ${error.message}`;}

  const observer=new ResizeObserver(resizeCanvas);observer.observe(space);observer.observe(treeHost);window.addEventListener('resize',layoutTile);
  resizeCanvas();loadHelp();startTreeTile();loadDataset().catch(showError);requestAnimationFrame(render);
})();
