/*
 * Camada de compatibilidade para a dependência pulse.js.
 * O ficheiro pulse.js original não foi fornecido. Esta implementação expõe
 * apenas as APIs utilizadas pelos módulos Tree e PCA recebidos.
 */
(function (global) {
  'use strict';

  const _ = global._ = global._ || {};

  class List extends Array {
    constructor(...args) { super(...args); this.type = 'List'; this.isList = true; }
    clone() { const copy = new this.constructor(); this.forEach(value => copy.push(Array.isArray(value) && value.clone ? value.clone() : value)); copy.name = this.name; return copy; }
    getMean() { return this.length ? this.reduce((sum, value) => sum + Number(value || 0), 0) / this.length : 0; }
    getStandardDeviation() { const mean = this.getMean(); return Math.sqrt(this.reduce((sum, value) => sum + Math.pow(Number(value || 0) - mean, 2), 0) / Math.max(1, this.length)); }
    getRandomElement() { return this[Math.floor(Math.random() * this.length)]; }
    getImproved() { return this; }
    toL() { return this; }
    tonL() { return this; }
    downcast() { return this; }
  }

  class NumberList extends List { constructor(...args) { super(...args); this.type = 'nL'; } }
  class Table extends List { constructor(...args) { super(...args); this.type = 'Table'; this.isTable = true; } }
  class NumberTable extends Table { constructor(...args) { super(...args); this.type = 'nT'; } }

  _.L = List;
  _.nL = NumberList;
  _.T = Table;
  _.nT = NumberTable;
  _.toL = values => Object.assign(new List(...values), { name: values.name });
  _.toT = values => Object.assign(new Table(...values), { name: values.name });
  _.normalizeByZScore = list => {
    const output = new NumberList();
    const mean = list.getMean ? list.getMean() : list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length);
    const deviation = list.getStandardDeviation ? list.getStandardDeviation() : 1;
    list.forEach(value => output.push(deviation ? (value - mean) / deviation : 0));
    output.name = list.name;
    return output;
  };
  _.normalizeLists = table => {
    const output = new NumberTable();
    table.forEach(list => {
      const min = Math.min(...list);
      const max = Math.max(...list);
      const result = new NumberList();
      list.forEach(value => result.push(max === min ? 0 : (value - min) / (max - min)));
      result.name = list.name;
      output.push(result);
    });
    return output;
  };
  _.dotProduct = (a, b) => a.reduce((sum, value, index) => sum + value * (b[index] || 0), 0);
  _.getRandomRows = table => table.clone();
  _.cleanText = value => String(value || '').toLocaleLowerCase('pt-PT').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  _.dateToString = date => new Date(date).toISOString();
  _.expandSimpleHtml = value => String(value || '').replace(/\n/g, '<br>');

  Table.prototype.transpose = function () {
    const output = new NumberTable();
    const rows = this.length ? this[0].length : 0;
    for (let row = 0; row < rows; row++) {
      const line = new NumberList();
      for (let column = 0; column < this.length; column++) line.push(this[column][row]);
      output.push(line);
    }
    return output;
  };

  class Node {
    constructor(id, name) {
      this.id = id; this.name = name; this.to = []; this.from = [];
      this.parent = null; this.level = 0; this.weight = 1; this.descentWeight = 1;
    }
  }

  class Tree {
    constructor() { this.nodes = []; this._byId = new Map(); this.nLevels = 0; }
    get(id) { return this._byId.get(id) || null; }
    addNodeToTree(node, parent) {
      if (this._byId.has(node.id)) return this._byId.get(node.id);
      node.parent = parent || null;
      node.level = parent ? parent.level + 1 : 0;
      if (parent) { parent.to.push(node); node.from.push(parent); }
      this.nodes.push(node); this._byId.set(node.id, node);
      this.nLevels = Math.max(this.nLevels, node.level + 1);
      return node;
    }
    assignDescentWeightsToNodes() {
      const visit = node => {
        if (!node.to.length) { node.weight = Math.max(1, node.nDown || node.size || 1); node.descentWeight = node.weight; return node.weight; }
        node.weight = node.to.reduce((sum, child) => sum + visit(child), 0);
        node.descentWeight = node.weight;
        return node.weight;
      };
      if (this.nodes[0]) visit(this.nodes[0]);
    }
    getLeaves() { return this.nodes.filter(node => !node.to.length); }
  }
  _.Nd = Node;
  _.Tr = Tree;

  if (!Array.prototype.toL) Object.defineProperty(Array.prototype, 'toL', { value: function () { return _.toL(this); }, configurable: true });
  if (!Array.prototype.tonL) Object.defineProperty(Array.prototype, 'tonL', { value: function () { return Object.assign(new NumberList(...this), { name: this.name }); }, configurable: true });
  if (!Array.prototype.downcast) Object.defineProperty(Array.prototype, 'downcast', { value: function () { return this; }, configurable: true });

  class Rec {
    constructor(x = 0, y = 0, width = 0, height = 0) { this.x = x; this.y = y; this.width = width; this.height = height; }
  }
  _.Rec = Rec;

  _.squarify = function (frame, weights) {
    const total = weights.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0) || 1;
    let cursor = 0;
    const vertical = frame.width >= frame.height;
    return weights.map((weight, index) => {
      const fraction = Math.max(0, Number(weight || 0)) / total;
      let rectangle;
      if (vertical) {
        const width = index === weights.length - 1 ? frame.width - cursor : frame.width * fraction;
        rectangle = new Rec(frame.x + cursor, frame.y, Math.max(0, width), frame.height);
        cursor += width;
      } else {
        const height = index === weights.length - 1 ? frame.height - cursor : frame.height * fraction;
        rectangle = new Rec(frame.x, frame.y + cursor, frame.width, Math.max(0, height));
        cursor += height;
      }
      return rectangle;
    });
  };

  class MetaCanvas {
    constructor(options = {}) {
      this.options = options;
      this.canvas = document.createElement('canvas');
      this.context = this.canvas.getContext('2d');
      this.canvas.setAttribute('aria-label', 'Árvore probabilística interativa de tokens');
      this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
      (document.getElementById('maindiv') || document.body).appendChild(this.canvas);
      this.W = 1; this.H = 1; this.mX = -1000; this.mY = -1000;
      this.WHEEL_CHANGE = 0; this.MOUSE_PRESSED = false; this.MOUSE_UP_FAST = false;
      this.DX_MOUSE_PRESSED = 0; this.DY_MOUSE_PRESSED = 0; this.COMMAND_PRESSED = false;
      this._pressedX = 0; this._pressedY = 0; this._pressedAt = 0; this._background = '#000';
      this._bind(); this._resize();
      this._observer = new ResizeObserver(() => this._resize());
      this._observer.observe(this.canvas.parentElement);
      requestAnimationFrame(() => this._loop());
    }

    _bind() {
      const position = event => {
        const rect = this.canvas.getBoundingClientRect();
        this.mX = event.clientX - rect.left;
        this.mY = event.clientY - rect.top;
      };
      this.canvas.addEventListener('pointermove', event => {
        const previousX = this.mX, previousY = this.mY;
        position(event);
        if (this.MOUSE_PRESSED) {
          this.DX_MOUSE_PRESSED = this.mX - previousX;
          this.DY_MOUSE_PRESSED = this.mY - previousY;
        }
      });
      this.canvas.addEventListener('pointerdown', event => {
        position(event); this.MOUSE_PRESSED = true; this._pressedX = this.mX; this._pressedY = this.mY; this._pressedAt = performance.now();
        this.COMMAND_PRESSED = event.metaKey || event.ctrlKey;
        this.canvas.setPointerCapture(event.pointerId);
      });
      this.canvas.addEventListener('pointerup', event => {
        position(event); this.MOUSE_PRESSED = false;
        this.MOUSE_UP_FAST = performance.now() - this._pressedAt < 650 && Math.hypot(this.mX - this._pressedX, this.mY - this._pressedY) < 12;
      });
      this.canvas.addEventListener('pointerleave', () => { this.MOUSE_PRESSED = false; });
      this.canvas.addEventListener('wheel', event => { event.preventDefault(); this.WHEEL_CHANGE = event.deltaY < 0 ? 1 : -1; }, { passive: false });
    }

    _resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.W = Math.max(1, rect.width); this.H = Math.max(1, rect.height);
      this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr);
      this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.options.resize) this.options.resize();
    }

    _loop() {
      this.context.clearRect(0, 0, this.W, this.H);
      this.context.fillStyle = this._background;
      this.context.fillRect(0, 0, this.W, this.H);
      if (this.options.cycle) this.options.cycle();
      this.WHEEL_CHANGE = 0; this.MOUSE_UP_FAST = false; this.DX_MOUSE_PRESSED = 0; this.DY_MOUSE_PRESSED = 0;
      requestAnimationFrame(() => this._loop());
    }

    setBackgroundColor(color) { this._background = color; }
    setZOOMABLE() {}
    setDRAGGABLE() {}
    fill(color) { this.context.fillStyle = color; }
    stroke(color, width = 1) { this.context.strokeStyle = color; this.context.lineWidth = width; }
    fRect(x, y, width, height) { this.context.fillRect(x, y, Math.max(0, width), Math.max(0, height)); }
    sRect(x, y, width, height) { this.context.strokeRect(x, y, Math.max(0, width), Math.max(0, height)); }
    fsRectM(x, y, width, height) {
      this.fRect(x, y, width, height);
      return this.mX >= x && this.mX <= x + width && this.mY >= y && this.mY <= y + height;
    }
    setText(color, size, family = 'Arial', align, baseline = 'alphabetic') {
      this.context.fillStyle = color; this.context.font = `${size}px ${family || 'Arial'}`;
      if (align) this.context.textAlign = align;
      this.context.textBaseline = baseline || 'alphabetic';
    }
    getTextW(text) { return this.context.measureText(String(text)).width; }
    fText(text, x, y) { this.context.fillText(String(text), x, y); }
    fTextWidth(text, x, y, maxWidth) { this.context.fillText(String(text), x, y, maxWidth); }
    clipRect(x, y, width, height) { this.context.save(); this.context.beginPath(); this.context.rect(x, y, width, height); this.context.clip(); }
    restore() { this.context.restore(); }
  }
  _.MetaCanvas = MetaCanvas;
})(window);
