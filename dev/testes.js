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

// duração editável: 3 horas bloqueia o intervalo inteiro
var D2 = new Date(Date.now() + 2 * 864e5);
D2 = D2.getFullYear() + '-' + String(D2.getMonth() + 1).padStart(2, '0') + '-' + String(D2.getDate()).padStart(2, '0');
var l3 = amb.salvarAgendamento({ clienteId: ana.id, data: D2, inicio: '14:00', duracao: 180 });
assert.strictEqual(l3.fim, '17:00');
falha(function () { amb.salvarAgendamento({ clienteId: bia.id, data: D2, inicio: '16:30', duracao: 30 }); }, 'Horário ocupado');
falha(function () { amb.salvarAgendamento({ clienteId: bia.id, data: D2, inicio: '12:30', duracao: 120 }); }, 'Horário ocupado');
var curto = amb.salvarAgendamento({ clienteId: bia.id, data: D2, inicio: '17:00', duracao: 30 });
assert.strictEqual(curto.fim, '17:30');
falha(function () { amb.salvarAgendamento({ clienteId: bia.id, data: D2, inicio: '20:00', duracao: 45 }); }, 'Duração inválida');
falha(function () { amb.salvarAgendamento({ clienteId: bia.id, data: D2, inicio: '22:00', duracao: 180 }); }, 'entre');
amb.excluirAgendamento(curto.id);

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

// pacote x avulso
var carla = amb.salvarCliente({ nome: 'Carla Dias' });
var D3 = new Date(Date.now() + 3 * 864e5);
D3 = D3.getFullYear() + '-' + String(D3.getMonth() + 1).padStart(2, '0') + '-' + String(D3.getDate()).padStart(2, '0');
var av = amb.salvarAgendamento({ clienteId: carla.id, data: D3, inicio: '06:00', procedimento: 'Make', tipo: 'Avulso', valor: '1.200,50' });
assert.strictEqual(av.tipo, 'Avulso'); assert.strictEqual(av.valor, '1200.5');
falha(function () { amb.salvarAgendamento({ clienteId: carla.id, data: D3, inicio: '08:00', tipo: 'Avulso', valor: 'abc' }); }, 'Valor');
falha(function () { amb.salvarAgendamento({ clienteId: carla.id, data: D3, inicio: '08:00', tipo: 'Pacote', pacote: { procedimentos: 'Botox', valor: 400 } }); }, 'sessões');
var s1 = amb.salvarAgendamento({ clienteId: carla.id, data: D3, inicio: '08:00', procedimento: 'Botox capilar', tipo: 'Pacote',
  pacote: { procedimentos: 'Botox capilar', sessoes: 4, valor: 'R$ 400', renovacao: '2027-01-10' } });
var pac = amb.carregarTudo().pacotes;
assert.strictEqual(pac.length, 1); assert.strictEqual(pac[0].valor, '400'); assert.strictEqual(pac[0].dataInicio, D3);
assert.strictEqual(s1.pacoteId, pac[0].id); assert.strictEqual(s1.valor, '');
var s2 = amb.salvarAgendamento({ clienteId: carla.id, data: D3, inicio: '10:00', tipo: 'Pacote',
  pacote: { id: pac[0].id, procedimentos: 'Botox capilar', sessoes: 5, valor: 400 } });
assert.strictEqual(s2.pacoteId, pac[0].id);
assert.strictEqual(amb.carregarTudo().pacotes[0].sessoes, '5');
falha(function () { amb.salvarAgendamento({ clienteId: ana.id, data: D3, inicio: '12:00', tipo: 'Pacote', pacote: { id: pac[0].id, procedimentos: 'x', sessoes: 1 } }); }, 'outra cliente');
// mudar só o status mantém tipo e pacote
var s2b = amb.salvarAgendamento({ id: s2.id, clienteId: carla.id, data: D3, inicio: '10:00', status: 'Concluído' });
assert.strictEqual(s2b.pacoteId, pac[0].id);
var av2 = amb.salvarAgendamento({ id: av.id, clienteId: carla.id, data: D3, inicio: '06:00', status: 'Concluído' });
assert.strictEqual(av2.valor, '1200.5');
// renomear leva o nome para o pacote
amb.salvarCliente({ id: carla.id, nome: 'Carla Dias Souza' });
assert.strictEqual(amb.carregarTudo().pacotes[0].clienteNome, 'Carla Dias Souza');
amb.excluirPacote(pac[0].id);
assert.strictEqual(amb.carregarTudo().pacotes.length, 0);
assert.strictEqual(amb.carregarTudo().agendamentos.filter(function (a) { return a.id === s1.id; })[0].tipo, '');
console.log('Pacote e avulso ✓');

// leitura das observações
var L = amb.lerObservacao_;
assert.strictEqual(L('pagou R$ 150,00 no pix').valor, '150');
assert.strictEqual(L('R$1.200 pacote').valor, '1200');
assert.strictEqual(L('120 reais').valor, '120');
assert.strictEqual(L('pg 90').valor, '90');
assert.strictEqual(L('cliente chegou 10/10 atrasada').valor, '');
assert.strictEqual(L('cliente chegou 12/10 atrasada').pacote, false);
var lp = L('Pacote 4 sessões 400,00');
assert.ok(lp.pacote); assert.strictEqual(lp.sessoes, 4); assert.strictEqual(lp.valor, '400');
var l2 = L('sessão 2/4');
assert.ok(l2.pacote); assert.strictEqual(l2.sessaoAtual, 2); assert.strictEqual(l2.sessoes, 4);
assert.strictEqual(L('3ª de 5').sessaoAtual, 3);

// importação: prévia e gravação
var dani = amb.salvarCliente({ nome: 'Dani' });
function dia(n) { var d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
amb.salvarAgendamento({ clienteId: dani.id, data: dia(10), inicio: '06:00', procedimento: 'Botox capilar', observacoes: 'Pacote 3 sessões R$ 300' });
amb.salvarAgendamento({ clienteId: dani.id, data: dia(11), inicio: '06:00', procedimento: 'Botox capilar', observacoes: 'pacote 2/3' });
amb.salvarAgendamento({ clienteId: dani.id, data: dia(12), inicio: '06:00', procedimento: 'Make', observacoes: 'pagou 80' });
amb.salvarAgendamento({ clienteId: dani.id, data: dia(13), inicio: '06:00', procedimento: 'Make', observacoes: 'trazer foto' });
var prev = amb.analisarObservacoes();
var dl = prev.linhas.filter(function (l) { return l.clienteId === dani.id; });
assert.strictEqual(dl.length, 4);
assert.strictEqual(dl.map(function (l) { return l.tipo; }).join(), ['Pacote', 'Pacote', 'Avulso', 'Ignorar'].join());
assert.ok(dl[0].novoPacote && !dl[1].novoPacote);
assert.strictEqual(dl[0].sessoes, 3); assert.strictEqual(dl[0].valor, '300');
var res = amb.aplicarObservacoes(dl);
assert.strictEqual([res.avulsos, res.pacotes, res.sessoes].join(), '1,1,2');
var tudoD = amb.carregarTudo();
var pd = tudoD.pacotes.filter(function (p) { return p.clienteId === dani.id; });
assert.strictEqual(pd.length, 1); assert.strictEqual(pd[0].valor, '300');
assert.strictEqual(tudoD.agendamentos.filter(function (a) { return a.pacoteId === pd[0].id; }).length, 2);
assert.ok(tudoD.agendamentos.every(function (a) { return a.observacoes !== 'pagou 80' || (a.tipo === 'Avulso' && a.valor === '80'); }));
// rodar de novo não duplica
assert.strictEqual(amb.analisarObservacoes().linhas.filter(function (l) { return l.clienteId === dani.id && l.tipo !== 'Ignorar'; }).length, 0);
console.log('Importar das observações ✓');
assert.strictEqual(L('renovou pacote 4 sessões 500').valor, '500');
assert.strictEqual(L('pacote 4 sessões').valor, '');
assert.strictEqual(L('volta dia 12/11 às 14:00').valor, '');
assert.strictEqual(L('3/4').valor, '');
console.log('Valores soltos ✓');
