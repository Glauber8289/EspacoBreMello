/**
 * Servidor local para testar o site sem publicar no Google.
 * Simula a planilha, a Agenda Google e o google.script.run em memória.
 *
 *   node dev/servidor-local.js        → abre em http://localhost:8080
 *
 * Os dados somem quando o servidor é fechado.
 */
process.env.TZ = 'America/Sao_Paulo';
var fs = require('fs');
var path = require('path');
var http = require('http');
var vm = require('vm');
var crypto = require('crypto');

var SRC = path.join(__dirname, '..', 'src');

function criarAmbiente() {
  var planilhas = {};
  var eventos = {};
  var props = {};

  function Aba(nome) {
    this.nome = nome;
    this.linhas = [];
  }
  Aba.prototype.getLastRow = function () { return this.linhas.length; };
  Aba.prototype.getMaxRows = function () { return 1000; };
  Aba.prototype.appendRow = function (l) { this.linhas.push(l.map(String)); };
  Aba.prototype.deleteRow = function (n) { this.linhas.splice(n - 1, 1); };
  Aba.prototype.setFrozenRows = function () {};
  Aba.prototype.getRange = function (r, c, nr, nc) {
    var aba = this;
    nr = nr || 1; nc = nc || 1;
    var range = {
      getValues: function () {
        var out = [];
        for (var i = 0; i < nr; i++) {
          var l = aba.linhas[r - 1 + i] || [];
          var o = [];
          for (var j = 0; j < nc; j++) o.push(l[c - 1 + j] === undefined ? '' : l[c - 1 + j]);
          out.push(o);
        }
        return out;
      },
      getValue: function () { return range.getValues()[0][0]; },
      setValues: function (v) {
        for (var i = 0; i < nr; i++) {
          while (aba.linhas.length < r + i) aba.linhas.push([]);
          for (var j = 0; j < nc; j++) aba.linhas[r - 1 + i][c - 1 + j] = String(v[i][j]);
        }
        return range;
      },
      setValue: function (v) { return range.setValues([[v]]); },
      setFontWeight: function () { return range; },
      setNumberFormat: function () { return range; }
    };
    return range;
  };

  function Planilha(id) { this.id = id; this.abas = {}; }
  Planilha.prototype.getSheetByName = function (n) { return this.abas[n] || null; };
  Planilha.prototype.insertSheet = function (n) { return (this.abas[n] = new Aba(n)); };
  Planilha.prototype.getId = function () { return this.id; };
  Planilha.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id; };

  function Evento(id, t, i, f, o) { this.id = id; this.t = t; this.i = i; this.f = f; this.d = (o || {}).description; }
  Evento.prototype.getId = function () { return this.id; };
  Evento.prototype.setTitle = function (t) { this.t = t; };
  Evento.prototype.setTime = function (i, f) { this.i = i; this.f = f; };
  Evento.prototype.setDescription = function (d) { this.d = d; };
  Evento.prototype.deleteEvent = function () { delete eventos[this.id]; };

  var agenda = {
    getName: function () { return 'espacobremello@gmail.com'; },
    getEventById: function (id) { return eventos[id] || null; },
    createEvent: function (t, i, f, o) {
      var id = crypto.randomUUID() + '@google.com';
      return (eventos[id] = new Evento(id, t, i, f, o));
    }
  };

  var ctx = {
    console: console,
    HtmlService: {},
    Logger: { log: console.log },
    PropertiesService: { getScriptProperties: function () {
      return { getProperty: function (k) { return props[k] || null; }, setProperty: function (k, v) { props[k] = v; } };
    } },
    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return planilhas.ativa || (planilhas.ativa = new Planilha('planilha-local')); },
      openById: function () { return planilhas.ativa; },
      create: function () { return planilhas.ativa = new Planilha('planilha-local'); }
    },
    CalendarApp: { getDefaultCalendar: function () { return agenda; }, getCalendarsByName: function () { return [agenda]; } },
    LockService: { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } },
    Session: { getScriptTimeZone: function () { return 'America/Sao_Paulo'; } },
    Utilities: {
      getUuid: function () { return crypto.randomUUID(); },
      formatDate: function (d, tz, fmt) {
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
          .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds())).replace(/'/g, '');
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  ctx.__eventos = eventos;
  ctx.CalendarApp.createCalendar = function () { return agenda; };
  ctx.__planilha = function () { return planilhas.ativa; };
  return ctx;
}

function montarPagina() {
  var inc = function (n) {
    return fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  };
  var html = inc('Index').replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, function (_, n) { return inc(n); });
  var shim = '<script>window.google={script:{get run(){var ok=function(){},err=function(){};var p=new Proxy({},{get:function(_,k){' +
    'if(k==="withSuccessHandler")return function(f){ok=f;return p};if(k==="withFailureHandler")return function(f){err=f;return p};' +
    'return function(){fetch("/api/"+k,{method:"POST",body:JSON.stringify([].slice.call(arguments))}).then(function(r){return r.json()})' +
    '.then(function(r){r.erro?err(new Error(r.erro)):ok(r.valor)}).catch(err)}}});return p}}};</script>';
  return html.replace('<head>', '<head>' + shim);
}

module.exports = { criarAmbiente: criarAmbiente, montarPagina: montarPagina };

if (require.main === module) {
  var app = criarAmbiente();
  app.configurar();
  var porta = +process.env.PORT || 8080;
  http.createServer(function (req, res) {
    if (req.method === 'POST' && req.url.indexOf('/api/') === 0) {
      var corpo = '';
      req.on('data', function (c) { corpo += c; });
      req.on('end', function () {
        var fn = req.url.slice(5), saida;
        try {
          if (typeof app[fn] !== 'function' || /_$/.test(fn)) throw new Error('Função desconhecida: ' + fn);
          saida = { valor: app[fn].apply(null, JSON.parse(corpo || '[]')) };
        } catch (e) { saida = { erro: e.message }; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(saida));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(montarPagina());
  }).listen(porta, function () { console.log('Servidor local em http://localhost:' + porta); });
}
