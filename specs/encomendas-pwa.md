# Encomendas PWA — slice 1

## Goal
Ver de relance, no iPhone, que encomendas de modelos 3D recebi, quais estão a imprimir, quais tenho em stock, quais estão prontas para imprimir e quais estão pagas — mesmo sem rede, com sync para o Google Sheets quando houver.

Build model: sonnet — CRUD de uma lista, service worker e um endpoint Apps Script; nada de raciocínio difícil.

## Requirements

1. **Criar encomenda à mão.** Formulário com: cliente, modelo, quantidade, preço total, estado, pago (sim/não), notas. Cliente e modelo obrigatórios.
   Verify: no Safari/Chrome, abrir a PWA, tentar guardar sem cliente → mensagem de erro e nada guardado; preencher tudo → a encomenda aparece na lista.

2. **Estados.** Estado é um de: `recebida`, `em stock`, `pronta para imprimir`, `a imprimir`, `entregue`. Pago é um campo separado (checkbox).
   Verify: editar uma encomenda e mudar cada estado; o valor aparece na lista e na linha do Sheet após sync.

3. **Lista com filtro.** Lista de encomendas com o estado e o indicador de pago visíveis em cada linha, e filtro por estado e por pago/não pago.
   Verify: com 5 encomendas de estados diferentes, cada filtro mostra exatamente as esperadas (teste automático ou screenshot).

4. **Editar e arquivar.** Qualquer campo pode ser editado depois de criada. Não há apagar permanente: "arquivar" esconde a encomenda da lista por defeito (filtro "arquivadas" mostra-as).
   Verify: arquivar uma encomenda → desaparece da lista; filtro "arquivadas" mostra-a; a linha mantém-se no Sheet com `archived=true`.

5. **Offline-first.** Todas as leituras e escritas vão primeiro para IndexedDB no telefone. A app abre, lista, cria e edita sem rede.
   Verify: com o modo avião ligado (ou DevTools → Offline), recarregar a PWA, criar e editar encomendas sem erros.

6. **Sync com Google Sheets.** Um Apps Script publicado como web app lê e escreve num Sheet (uma linha por encomenda, colunas: id, cliente, modelo, quantidade, preco, estado, pago, notas, arquivada, updated_at). A PWA envia alterações pendentes e puxa as do Sheet quando há rede, ao abrir e ao carregar em "sincronizar".
   Verify: criar uma encomenda offline, ligar a rede, sincronizar → a linha aparece no Sheet; editar uma linha no Sheet, sincronizar → a alteração aparece na PWA.

7. **Conflitos: ganha a última alteração.** Cada linha tem `updated_at`; em conflito fica a versão com `updated_at` mais recente.
   Verify: editar a mesma encomenda offline na PWA (t1) e depois no Sheet (t2 > t1) → após sync ambos mostram a versão do Sheet; invertendo a ordem, ambos mostram a da PWA.

8. **Acesso protegido por segredo.** O web app só responde se o pedido trouxer o segredo configurado no script; o segredo é guardado no telefone (introduzido uma vez nas definições da PWA) e nunca vai para o código servido.
   Verify: `curl` ao URL do web app sem segredo → erro/recusa e nenhuma linha devolvida; com o segredo → dados devolvidos. `grep` do segredo no repo e no site publicado → sem resultados.

9. **Instalável no iPhone.** A PWA tem manifest e service worker e pode ser adicionada ao ecrã principal, abrindo em ecrã inteiro e offline.
   Verify: Lighthouse "installable" passa; adicionar ao ecrã principal no iPhone, abrir em modo avião → a lista aparece.

## Edge Cases
- Sync falha a meio (rede cai): as alterações pendentes ficam na fila e são reenviadas; nenhuma é perdida nem duplicada (id gerado no telefone, escrita idempotente por id).
- Duas encomendas criadas offline em dispositivos diferentes: ids únicos (UUID), sem colisão.
- Linha do Sheet editada à mão com estado inválido: a PWA mostra-a como "estado desconhecido" em vez de falhar.
- Segredo errado ou web app indisponível: a app continua utilizável offline e mostra "sync falhou" sem perder dados.
- Preço ou quantidade não numérica: rejeitado no formulário.

## Decisions to Confirm
- [x] Idioma da interface: português — é o teu idioma de trabalho.
- [x] IDs são UUID gerados no telefone — permite criar offline sem colisões.
- [x] Arquivar em vez de apagar — evita perder dados por engano e simplifica o sync.
- [x] PWA alojada em página estática (GitHub Pages) sem dados teus — o URL é público, os dados só passam pelo Apps Script com segredo.
- [x] Segredo partilhado simples (não OAuth) — escolhido por ti; aceitas que quem tiver o segredo e o URL acede aos dados.
- [x] Sync manual + ao abrir a app (sem sync em segundo plano) — o iOS não garante background sync em PWAs.
- [x] Sem stack framework: HTML + JS puro (ou Preact), sem build pesada — mantém o projeto pequeno.
- [x] Moeda única, euro (€) — mercado em Portugal.

## Definition of Done
- [ ] Criar, editar, filtrar e arquivar encomendas funciona no iPhone, online e offline.
- [ ] Os cinco estados e o campo pago estão visíveis e filtráveis.
- [ ] Sync nos dois sentidos com o Google Sheets verificado com criação offline e edição no Sheet.
- [ ] Conflito resolvido por `updated_at` e verificado nos dois sentidos.
- [ ] Acesso sem segredo recusado (`curl`) e segredo ausente do repo e do site publicado.
- [ ] A PWA instala-se no ecrã principal e abre offline.
- [ ] README com setup (criar Sheet, colar o script, publicar, hospedar a PWA) e uso.

## Next Slices
- Notificações ou lembretes de encomendas pendentes.
- Campos extra: cor/filamento, data prometida, link do modelo.
- Partilha do WhatsApp para a app (criar encomenda a partir de uma mensagem).
- Resumo/total a receber (soma das encomendas não pagas).
