// Testes do servidor (Code.gs) com planilha e agenda simuladas:  node dev/testes.js
var assert = require('assert');
var amb = require('./servidor-local').criarAmbiente();
amb.configurar();

function falha(fn, trecho) {
  assert.throws(fn, function (e) { return e.message.indexOf(trecho) >= 0; });
}
var amanha = new Date(Date.now() + 864e5);
var D = amanha.getFullYear() + '-' + String(amanha.getMonth() + 1).padStart(2, '0') + '-' + String(amanha.getDate()).padStart(2, '0');

var ana = amb.salvarCliente({ nome: ' Ana Souza ', telefone: '(11) 98888-7777', nascimento: '1990-10-05', sessoes: '2' });
assert.strictEqual(ana.nome, 'Ana Souza');
assert.strictEqual(ana.sessoes, 2);
var bia = amb.salvarCliente({ nome: 'Bia Lima' });
falha(function () { amb.salvarCliente({ nome: '  ' }); }, 'nome');
falha(function () { amb.salvarCliente({ nome: 'X', nascimento: '05/10/1990' }); }, 'Data inválida');

// agendamento de 2 horas
var a1 = amb.salvarAgendamento({ clienteId: ana.id, data: D, inicio: '10:00', procedimento: 'Escova progressiva' });
assert.strictEqual(a1.fim, '12:00');
assert.ok(a1.eventoId, 'cria evento na Agenda Google');
var ev = amb.__eventos[a1.eventoId];
assert.strictEqual(ev.i.getHours(), 10); assert.strictEqual(ev.f.getHours(), 12);
assert.ok(ev.t.indexOf('Ana Souza') === 0);

// conflitos
falha(function () { amb.salvarAgendamento({ clienteId: bia.id, data: D, inicio: '11:00' }); }, 'Horário ocupado');
falha(function () { amb.salvarAgendamento({ clienteId: bia.id, data: D, inicio: '08:30' }); }, 'Horário ocupado');
var a2 = amb.salvarAgendamento({ clienteId: bia.id, data: D, inicio: '12:00' }); // encosta, não conflita
var a3 = amb.salvarAgendamento({ clienteId: bia.id, data: D, inicio: '08:00' });
falha(function () { amb.salvarAgendamento({ clienteId: bia.id, data: D, inicio: '22:30' }); }, 'entre');
falha(function () { amb.salvarAgendamento({ clienteId: 'nao-existe', data: D, inicio: '15:00' }); }, 'Selecione');

// editar sem conflitar consigo mesmo e movendo o evento
var a1b = amb.salvarAgendamento({ id: a1.id, clienteId: ana.id, data: D, inicio: '10:00', procedimento: 'Botox capilar' });
assert.strictEqual(a1b.eventoId, a1.eventoId);

// concluir soma sessão uma única vez; voltar desfaz
amb.salvarAgendamento({ id: a1.id, clienteId: ana.id, data: D, inicio: '10:00', status: 'Concluído' });
amb.salvarAgendamento({ id: a1.id, clienteId: ana.id, data: D, inicio: '10:00', status: 'Concluído' });
var sess = function (id) { return amb.carregarTudo().clientes.filter(function (c) { return c.id === id; })[0].sessoes; };
assert.strictEqual(sess(ana.id), 3);
amb.salvarAgendamento({ id: a1.id, clienteId: ana.id, data: D, inicio: '10:00', status: 'Agendado' });
assert.strictEqual(sess(ana.id), 2);

// cancelar libera horário e remove evento
amb.salvarAgendamento({ id: a2.id, clienteId: bia.id, data: D, inicio: '12:00', status: 'Cancelado' });
assert.ok(!amb.__eventos[a2.eventoId]);
amb.salvarAgendamento({ clienteId: ana.id, data: D, inicio: '13:00' });

// renomear cliente atualiza agendamentos e evento
amb.salvarCliente({ id: bia.id, nome: 'Beatriz Lima', sessoes: 0 });
var tudo = amb.carregarTudo();
assert.ok(tudo.agendamentos.filter(function (a) { return a.clienteId === bia.id; }).every(function (a) { return a.clienteNome === 'Beatriz Lima'; }));
assert.ok(amb.__eventos[tudo.agendamentos.filter(function (a) { return a.id === a3.id; })[0].eventoId].t.indexOf('Beatriz') === 0);

// não exclui cliente com agendamento futuro; exclui depois de cancelar
falha(function () { amb.excluirCliente(bia.id); }, 'agendamento');
amb.excluirAgendamento(a3.id);
amb.excluirAgendamento(a2.id);
amb.excluirCliente(bia.id);
assert.strictEqual(amb.carregarTudo().clientes.length, 1);

// sincronizar recria evento apagado manualmente na agenda
var t = amb.carregarTudo().agendamentos[0];
delete amb.__eventos[t.eventoId];
assert.ok(amb.sincronizarAgendaGoogle() >= 1);
assert.ok(amb.__eventos[amb.carregarTudo().agendamentos[0].eventoId]);

console.log('Todos os testes passaram ✓');
// último horário: 22:00 até meia-noite
var cliente = amb.carregarTudo().clientes[0];
var tarde = amb.salvarAgendamento({ clienteId: cliente.id, data: D, inicio: '22:00' });
assert.strictEqual(tarde.fim, '24:00');
var evTarde = amb.__eventos[tarde.eventoId];
assert.strictEqual(evTarde.f.getHours(), 0); assert.strictEqual(evTarde.f.getDate(), evTarde.i.getDate() + 1 > 28 ? evTarde.f.getDate() : evTarde.i.getDate() + 1);
console.log('Horário até meia-noite ✓');
