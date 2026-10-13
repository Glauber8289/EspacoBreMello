# Espaço Bre Melo — Clientes e Agenda

Site para o Espaço Bre Melo com duas funções:

- **Clientes**: cadastro com nome, telefone, data de nascimento, quantidade de sessões e observações. Mostra as aniversariantes do mês e um atalho para o WhatsApp de cada cliente.
- **Agenda**: visão da semana (no celular, um dia por vez). Cada agendamento reserva **2 horas** e o sistema não deixa marcar duas clientes no mesmo horário. Ao marcar um atendimento como **Concluído**, a ficha da cliente ganha +1 sessão automaticamente.

Os dados ficam numa **planilha Google** da conta do espaço, então os dois usam o mesmo site e veem as mesmas informações. Todo agendamento também aparece na **Agenda Google** da conta do espaço, e a aba **Exportar** baixa tudo em **Excel (.xlsx)**.

## Como funciona

O site é um *Web App* do Google Apps Script (gratuito), ligado à planilha e à agenda da conta Google do espaço. Não há servidor para pagar nem manter.

```
src/
  Code.gs          servidor: planilha, regras dos horários e Agenda Google
  Index.html       estrutura da página
  Styles.html      visual (paleta do catálogo)
  App.html         funcionamento da página
  Logo.html        logo em formato embutido
  appsscript.json  fuso horário (São Paulo) e permissões do web app
dev/
  servidor-local.js  roda o site no computador, com dados de teste
  testes.js          testes das regras (conflito de horário, sessões, agenda)
```

Horário de funcionamento, duração e intervalo dos horários ficam no topo de `src/Code.gs` (`CONFIG`). Por padrão: das 08:00 às 23:00 (último atendimento começa às 21:00), atendimentos de 2 horas, horários a cada 30 minutos.

## Instalação (uma vez, na conta Google do espaço)

1. Entre no Google com a **conta do espaço** e crie uma planilha nova em [sheets.new](https://sheets.new). Dê o nome **Espaço Bre Melo — Dados**.
2. Na planilha, abra **Extensões → Apps Script**.
3. No editor:
   - Apague o conteúdo de `Código.gs` e cole o de `src/Code.gs`.
   - Clique em **+ → HTML** e crie os arquivos `Index`, `Styles`, `App` e `Logo` (sem o `.html`), colando o conteúdo de cada um.
   - Em **Configurações do projeto** (engrenagem), marque *Mostrar arquivo de manifesto "appsscript.json"* e cole o conteúdo de `src/appsscript.json`.
4. Selecione a função **configurar** no topo e clique em **Executar**. O Google vai pedir autorização para acessar a planilha e a agenda: aceite (aparece um aviso de "app não verificado" porque o app é seu; clique em *Avançado → Acessar*).
5. Clique em **Implantar → Nova implantação → App da Web**:
   - *Executar como*: **Eu**
   - *Quem pode acessar*: **Somente eu**
6. Copie o link que termina em `/exec`. Esse é o endereço do site.

No celular, abra o link no navegador logado na conta do espaço e use **Adicionar à tela inicial** para ter um atalho como se fosse um aplicativo.

### Quem pode acessar

Há duas formas:

**A) Todos usam a conta do espaço** (padrão, mais simples). Na implantação: *Executar como*: **Eu**, *Quem pode acessar*: **Somente eu**. Quem estiver logado na conta Google do espaço abre o site.

**B) Cada um usa a própria conta Google.** O acesso é controlado pelo compartilhamento do Google: só quem tem acesso à planilha e à agenda do espaço consegue ver e mexer nos dados.
1. Rode **configurar** uma vez com a conta do espaço (ele guarda qual agenda usar).
2. Compartilhe a **planilha** (botão *Compartilhar*) com os e-mails pessoais, como **Editor**.
3. Em [calendar.google.com](https://calendar.google.com), na conta do espaço: *Configurações da agenda → Compartilhar com pessoas específicas* → adicione os mesmos e-mails com **Fazer alterações nos eventos**.
4. Na implantação: *Executar como*: **Usuário que acessa o app da Web**, *Quem pode acessar*: **Qualquer pessoa com conta Google**.
5. No primeiro acesso, cada pessoa autoriza o app com a própria conta.

Nunca use *Executar como: Eu* junto com *Qualquer pessoa com conta Google*: nesse caso qualquer pessoa com o link veria todas as clientes.

### Agenda Google

Os agendamentos são criados na agenda principal da conta do espaço. Para vê-los também na agenda pessoal de vocês: em [calendar.google.com](https://calendar.google.com), na conta do espaço, abra *Configurações da agenda → Compartilhar com pessoas específicas* e adicione os e-mails pessoais.

Se preferir uma agenda separada só para atendimentos, coloque o nome dela em `NOME_AGENDA` no `Code.gs` (ela é criada automaticamente).

O botão **Sincronizar** na aba Exportar recria na Agenda Google qualquer agendamento futuro cujo evento tenha sido apagado por engano.

## Endereço curto

A pasta `docs/` publica, pelo GitHub Pages, o endereço **https://glauber8289.github.io/EspacoBreMello/**, que redireciona para o link `/exec` do Apps Script. Se um dia fizer uma *nova implantação* (em vez de editar a existente), troque o link em `docs/index.html`.

Para ativar: no GitHub, **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / docs → Save**.

## Atualizar o site depois de uma mudança no código

Cole os arquivos alterados no editor do Apps Script e use **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar**. O link continua o mesmo.

Opcional, para enviar direto do GitHub/computador: instale o [clasp](https://github.com/google/clasp) (`npm i -g @google/clasp`), rode `clasp login`, copie `.clasp.json.exemplo` para `.clasp.json` com o ID do script (em Configurações do projeto) e use `clasp push`.

## Testar no computador

Com o [Node.js](https://nodejs.org) instalado:

```
npm test         # testa as regras do servidor
npm run local    # abre o site em http://localhost:8080 com dados de teste (somem ao fechar)
```
