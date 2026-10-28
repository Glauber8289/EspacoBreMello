/**
 * Espaço Bre Melo — Sistema de clientes e agendamentos
 *
 * Roda como um Web App do Google Apps Script, ligado a uma planilha Google
 * (onde ficam os dados) e à Agenda Google da conta do espaço.
 */

var CONFIG = {
  DURACAO_MIN: 120,          // duração padrão de um agendamento (2 horas); pode ser trocada em cada agendamento
  DURACAO_MAX_MIN: 480,      // duração máxima que pode ser escolhida (8 horas)
  HORA_ABERTURA: '06:00',
  HORA_FECHAMENTO: '24:00',  // meia-noite (use 24:00, não 00:00); último atendimento começa às 22:00
  INTERVALO_MIN: 30,         // horários oferecidos a cada 30 minutos
  NOME_AGENDA: ''            // vazio = agenda principal da conta; ou o nome de outra agenda
};

var ABA_CLIENTES = 'Clientes';
var ABA_AGENDAMENTOS = 'Agendamentos';

var COLS_CLIENTES = ['id', 'nome', 'telefone', 'nascimento', 'sessoes', 'observacoes', 'criadoEm', 'atualizadoEm'];
var COLS_AGENDAMENTOS = ['id', 'clienteId', 'clienteNome', 'data', 'inicio', 'fim', 'procedimento', 'status',
  'observacoes', 'eventoId', 'criadoEm', 'atualizadoEm'];

var STATUS = { AGENDADO: 'Agendado', CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado' };

/* ------------------------------------------------------------------ */
/* Web App                                                              */
/* ------------------------------------------------------------------ */

function doGet() {
  garantirEstrutura_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Espaço Bre Melo')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

/**
 * Rode uma vez pelo editor do Apps Script (menu Executar) para criar as abas
 * e autorizar o acesso à planilha e à Agenda Google.
 */
function configurar() {
  garantirEstrutura_();
  PropertiesService.getScriptProperties().deleteProperty('AGENDA_ID');
  var agenda = obterAgenda_();
  // Guarda a agenda do espaço para que todos que usam o site gravem nela,
  // mesmo quando o site roda com a conta pessoal de quem acessa.
  PropertiesService.getScriptProperties().setProperty('AGENDA_ID', agenda.getId());
  Logger.log('Planilha pronta: ' + planilha_().getUrl());
  Logger.log('Agenda usada: ' + agenda.getName() + ' (' + agenda.getId() + ')');
}

/* ------------------------------------------------------------------ */
/* API chamada pela página (google.script.run)                          */
/* ------------------------------------------------------------------ */

function carregarTudo() {
  return {
    clientes: lerTabela_(ABA_CLIENTES, COLS_CLIENTES).map(normalizarCliente_),
    agendamentos: lerTabela_(ABA_AGENDAMENTOS, COLS_AGENDAMENTOS).map(normalizarAgendamento_),
    config: CONFIG,
    agenda: obterAgenda_().getName(),
    planilhaUrl: planilha_().getUrl()
  };
}

function salvarCliente(dados) {
  return comTrava_(function () {
    var nome = texto_(dados.nome);
    if (!nome) throw new Error('Informe o nome da cliente.');
    var cliente = {
      id: dados.id || novoId_(),
      nome: nome,
      telefone: texto_(dados.telefone),
      nascimento: validarData_(dados.nascimento, true),
      sessoes: Math.max(0, parseInt(dados.sessoes, 10) || 0),
      observacoes: texto_(dados.observacoes),
      atualizadoEm: agoraIso_()
    };
    var aba = aba_(ABA_CLIENTES);
    var linha = acharLinha_(aba, cliente.id);
    if (linha) {
      var atual = lerLinha_(aba, linha, COLS_CLIENTES);
      cliente.criadoEm = atual.criadoEm;
      escreverLinha_(aba, linha, COLS_CLIENTES, cliente);
      if (atual.nome !== cliente.nome) renomearClienteNosAgendamentos_(cliente);
    } else {
      cliente.criadoEm = cliente.atualizadoEm;
      aba.appendRow(COLS_CLIENTES.map(function (c) { return cliente[c] === undefined ? '' : cliente[c]; }));
    }
    return normalizarCliente_(cliente);
  });
}

function excluirCliente(id) {
  return comTrava_(function () {
    var futuros = lerTabela_(ABA_AGENDAMENTOS, COLS_AGENDAMENTOS).filter(function (a) {
      return a.clienteId === id && a.status === STATUS.AGENDADO && a.data >= hojeIso_();
    });
    if (futuros.length) {
      throw new Error('Esta cliente tem ' + futuros.length + ' agendamento(s) futuro(s). Cancele-os antes de excluir.');
    }
    var aba = aba_(ABA_CLIENTES);
    var linha = acharLinha_(aba, id);
    if (linha) aba.deleteRow(linha);
    return true;
  });
}

function salvarAgendamento(dados) {
  return comTrava_(function () {
    var cliente = lerTabela_(ABA_CLIENTES, COLS_CLIENTES).filter(function (c) { return c.id === dados.clienteId; })[0];
    if (!cliente) throw new Error('Selecione uma cliente cadastrada.');

    var data = validarData_(dados.data, false);
    var inicio = validarHora_(dados.inicio);
    var duracao = validarDuracao_(dados.duracao);
    var fim = somarMinutos_(inicio, duracao);
    if (inicio < CONFIG.HORA_ABERTURA || fim > CONFIG.HORA_FECHAMENTO) {
      throw new Error('O horário precisa ficar entre ' + CONFIG.HORA_ABERTURA + ' e ' + CONFIG.HORA_FECHAMENTO +
        ' (este atendimento vai das ' + inicio + ' às ' + fim + ').');
    }
    var status = [STATUS.AGENDADO, STATUS.CONCLUIDO, STATUS.CANCELADO].indexOf(dados.status) >= 0
      ? dados.status : STATUS.AGENDADO;

    var aba = aba_(ABA_AGENDAMENTOS);
    var id = dados.id || novoId_();
    var linha = dados.id ? acharLinha_(aba, id) : 0;
    var anterior = linha ? lerLinha_(aba, linha, COLS_AGENDAMENTOS) : null;

    if (status !== STATUS.CANCELADO) {
      var conflito = lerTabela_(ABA_AGENDAMENTOS, COLS_AGENDAMENTOS).filter(function (a) {
        return a.id !== id && a.status !== STATUS.CANCELADO && a.data === data &&
          a.inicio < fim && inicio < a.fim;
      })[0];
      if (conflito) {
        throw new Error('Horário ocupado: ' + conflito.clienteNome + ' das ' + conflito.inicio + ' às ' +
          conflito.fim + '. Escolha outro horário.');
      }
    }

    var ag = {
      id: id,
      clienteId: cliente.id,
      clienteNome: cliente.nome,
      data: data,
      inicio: inicio,
      fim: fim,
      procedimento: texto_(dados.procedimento),
      status: status,
      observacoes: texto_(dados.observacoes),
      eventoId: anterior ? anterior.eventoId : '',
      criadoEm: anterior ? anterior.criadoEm : agoraIso_(),
      atualizadoEm: agoraIso_()
    };

    ag.eventoId = sincronizarEvento_(ag, cliente);

    if (linha) escreverLinha_(aba, linha, COLS_AGENDAMENTOS, ag);
    else aba.appendRow(COLS_AGENDAMENTOS.map(function (c) { return ag[c]; }));

    // Ao concluir um atendimento, soma uma sessão na ficha da cliente.
    var eraConcluido = anterior && anterior.status === STATUS.CONCLUIDO && anterior.clienteId === cliente.id;
    var ehConcluido = status === STATUS.CONCLUIDO;
    if (ehConcluido && !eraConcluido) ajustarSessoes_(cliente.id, +1);
    if (!ehConcluido && eraConcluido) ajustarSessoes_(cliente.id, -1);
    if (anterior && anterior.status === STATUS.CONCLUIDO && anterior.clienteId !== cliente.id) {
      ajustarSessoes_(anterior.clienteId, -1);
    }

    return normalizarAgendamento_(ag);
  });
}

function excluirAgendamento(id) {
  return comTrava_(function () {
    var aba = aba_(ABA_AGENDAMENTOS);
    var linha = acharLinha_(aba, id);
    if (!linha) return true;
    var ag = lerLinha_(aba, linha, COLS_AGENDAMENTOS);
    apagarEvento_(ag.eventoId);
    if (ag.status === STATUS.CONCLUIDO) ajustarSessoes_(ag.clienteId, -1);
    aba.deleteRow(linha);
    return true;
  });
}

/** Recria na Agenda Google os eventos que estiverem faltando (agendamentos antigos ou importados). */
function sincronizarAgendaGoogle() {
  return comTrava_(function () {
    var aba = aba_(ABA_AGENDAMENTOS);
    var clientes = {};
    lerTabela_(ABA_CLIENTES, COLS_CLIENTES).forEach(function (c) { clientes[c.id] = c; });
    var linhas = lerTabela_(ABA_AGENDAMENTOS, COLS_AGENDAMENTOS);
    var total = 0;
    linhas.forEach(function (ag, i) {
      if (ag.data < hojeIso_()) return;
      var novoId = sincronizarEvento_(ag, clientes[ag.clienteId] || { nome: ag.clienteNome, telefone: '' });
      if (novoId !== ag.eventoId) {
        ag.eventoId = novoId;
        escreverLinha_(aba, i + 2, COLS_AGENDAMENTOS, ag);
      }
      total++;
    });
    return total;
  });
}

/* ------------------------------------------------------------------ */
/* Agenda Google                                                        */
/* ------------------------------------------------------------------ */

function obterAgenda_() {
  var id = PropertiesService.getScriptProperties().getProperty('AGENDA_ID');
  if (id) {
    var agenda = CalendarApp.getCalendarById(id);
    if (!agenda) throw new Error('Sua conta não tem acesso à agenda do espaço. Peça para compartilharem a agenda com você.');
    return agenda;
  }
  if (CONFIG.NOME_AGENDA) {
    var lista = CalendarApp.getCalendarsByName(CONFIG.NOME_AGENDA);
    if (lista.length) return lista[0];
    return CalendarApp.createCalendar(CONFIG.NOME_AGENDA);
  }
  return CalendarApp.getDefaultCalendar();
}

function sincronizarEvento_(ag, cliente) {
  var agenda = obterAgenda_();
  var evento = null;
  if (ag.eventoId) {
    try { evento = agenda.getEventById(ag.eventoId); } catch (e) { evento = null; }
  }
  if (ag.status === STATUS.CANCELADO) {
    if (evento) evento.deleteEvent();
    return '';
  }
  var inicio = paraDate_(ag.data, ag.inicio);
  var fim = paraDate_(ag.data, ag.fim);
  var titulo = (ag.status === STATUS.CONCLUIDO ? '✓ ' : '') + cliente.nome +
    (ag.procedimento ? ' · ' + ag.procedimento : '');
  var descricao = [
    'Cliente: ' + cliente.nome,
    cliente.telefone ? 'Telefone: ' + cliente.telefone : '',
    ag.procedimento ? 'Procedimento: ' + ag.procedimento : '',
    'Status: ' + ag.status,
    ag.observacoes ? 'Obs.: ' + ag.observacoes : ''
  ].filter(String).join('\n') + '\n\nCriado pelo sistema do Espaço Bre Melo';

  if (evento) {
    evento.setTitle(titulo);
    evento.setTime(inicio, fim);
    evento.setDescription(descricao);
  } else {
    evento = agenda.createEvent(titulo, inicio, fim, { description: descricao });
  }
  return evento.getId();
}

function apagarEvento_(eventoId) {
  if (!eventoId) return;
  try {
    var evento = obterAgenda_().getEventById(eventoId);
    if (evento) evento.deleteEvent();
  } catch (e) { /* evento já removido manualmente */ }
}

/* ------------------------------------------------------------------ */
/* Planilha                                                             */
/* ------------------------------------------------------------------ */

function planilha_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PLANILHA_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('Sua conta não tem acesso à planilha do espaço. Peça para compartilharem a planilha com você.');
    }
  }
  var ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (ativa) {
    props.setProperty('PLANILHA_ID', ativa.getId());
    return ativa;
  }
  var nova = SpreadsheetApp.create('Espaço Bre Melo — Dados');
  props.setProperty('PLANILHA_ID', nova.getId());
  return nova;
}

function garantirEstrutura_() {
  var ss = planilha_();
  [[ABA_CLIENTES, COLS_CLIENTES], [ABA_AGENDAMENTOS, COLS_AGENDAMENTOS]].forEach(function (par) {
    var aba = ss.getSheetByName(par[0]);
    if (!aba) {
      aba = ss.insertSheet(par[0]);
      aba.getRange(1, 1, 1, par[1].length).setValues([par[1]]).setFontWeight('bold');
      aba.setFrozenRows(1);
      // Tudo como texto, para a planilha não converter datas e horas sozinha.
      aba.getRange(1, 1, aba.getMaxRows(), par[1].length).setNumberFormat('@');
    }
  });
}

function aba_(nome) {
  return planilha_().getSheetByName(nome);
}

function lerTabela_(nome, cols) {
  var aba = aba_(nome);
  var n = aba.getLastRow() - 1;
  if (n < 1) return [];
  return aba.getRange(2, 1, n, cols.length).getValues()
    .filter(function (l) { return l[0] !== ''; })
    .map(function (l) { return objeto_(l, cols); });
}

function lerLinha_(aba, linha, cols) {
  return objeto_(aba.getRange(linha, 1, 1, cols.length).getValues()[0], cols);
}

function escreverLinha_(aba, linha, cols, obj) {
  aba.getRange(linha, 1, 1, cols.length).setValues([cols.map(function (c) {
    return obj[c] === undefined ? '' : obj[c];
  })]);
}

function acharLinha_(aba, id) {
  var n = aba.getLastRow() - 1;
  if (n < 1 || !id) return 0;
  var ids = aba.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function objeto_(linha, cols) {
  var o = {};
  cols.forEach(function (c, i) {
    var v = linha[i];
    if (v instanceof Date) {
      v = (c === 'inicio' || c === 'fim')
        ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm')
        : Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    o[c] = v === null || v === undefined ? '' : String(v);
  });
  return o;
}

function renomearClienteNosAgendamentos_(cliente) {
  var aba = aba_(ABA_AGENDAMENTOS);
  lerTabela_(ABA_AGENDAMENTOS, COLS_AGENDAMENTOS).forEach(function (ag, i) {
    if (ag.clienteId !== cliente.id) return;
    ag.clienteNome = cliente.nome;
    if (ag.data >= hojeIso_()) ag.eventoId = sincronizarEvento_(ag, cliente);
    escreverLinha_(aba, i + 2, COLS_AGENDAMENTOS, ag);
  });
}

function ajustarSessoes_(clienteId, delta) {
  var aba = aba_(ABA_CLIENTES);
  var linha = acharLinha_(aba, clienteId);
  if (!linha) return;
  var col = COLS_CLIENTES.indexOf('sessoes') + 1;
  var celula = aba.getRange(linha, col);
  celula.setValue(String(Math.max(0, (parseInt(celula.getValue(), 10) || 0) + delta)));
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                           */
/* ------------------------------------------------------------------ */

function comTrava_(fn) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(20000)) throw new Error('O sistema está ocupado, tente de novo em alguns segundos.');
  try {
    return fn();
  } finally {
    trava.releaseLock();
  }
}

function normalizarCliente_(c) {
  return {
    id: String(c.id), nome: String(c.nome || ''), telefone: String(c.telefone || ''),
    nascimento: String(c.nascimento || ''), sessoes: parseInt(c.sessoes, 10) || 0,
    observacoes: String(c.observacoes || ''), criadoEm: String(c.criadoEm || '')
  };
}

function normalizarAgendamento_(a) {
  var o = {};
  COLS_AGENDAMENTOS.forEach(function (c) { o[c] = String(a[c] === undefined ? '' : a[c]); });
  return o;
}

function texto_(v) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, 500);
}

function validarData_(v, opcional) {
  v = texto_(v);
  if (!v && opcional) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Data inválida.');
  return v;
}

function validarHora_(v) {
  v = texto_(v);
  if (!/^\d{2}:\d{2}$/.test(v)) throw new Error('Horário inválido.');
  return v;
}

function validarDuracao_(v) {
  if (v === undefined || v === null || v === '') return CONFIG.DURACAO_MIN;
  var n = Number(v);
  if (!(n % CONFIG.INTERVALO_MIN === 0 && n >= CONFIG.INTERVALO_MIN && n <= CONFIG.DURACAO_MAX_MIN)) {
    throw new Error('Duração inválida: escolha de ' + CONFIG.INTERVALO_MIN + ' minutos a ' + (CONFIG.DURACAO_MAX_MIN / 60) + ' horas.');
  }
  return n;
}

function somarMinutos_(hora, minutos) {
  var p = hora.split(':');
  var total = parseInt(p[0], 10) * 60 + parseInt(p[1], 10) + minutos;
  return ('0' + Math.floor(total / 60)).slice(-2) + ':' + ('0' + (total % 60)).slice(-2);
}

function paraDate_(data, hora) {
  var d = data.split('-'), h = hora.split(':');
  return new Date(+d[0], +d[1] - 1, +d[2], +h[0], +h[1], 0);
}

function hojeIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function agoraIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function novoId_() {
  return Utilities.getUuid().slice(0, 8) + Date.now().toString(36);
}
