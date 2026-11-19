# Encomendas

PWA offline-first (HTML + JS puro) para acompanhar encomendas de modelos 3D, com sync para Google Sheets via Apps Script.

## Setup
1. Criar um Google Sheet novo (a folha `encomendas` é criada pelo script no primeiro sync).
2. Extensões → Apps Script → colar `apps-script/Code.gs`.
3. Definições do projeto → Propriedades do script → adicionar `SECRET` com um valor longo e aleatório.
4. Implementar → Nova implementação → Aplicação Web: executar como *eu*, acesso *qualquer pessoa*. Copiar o URL `/exec`. (O acesso "qualquer pessoa" é protegido pelo segredo.) Autorizar quando pedido; o trigger `onEdit` simples atualiza `updated_at` em edições manuais.
5. Alojar esta pasta no GitHub Pages (Settings → Pages → branch, raiz). Não contém segredo nem URL do Sheet.
6. No iPhone: abrir o URL no Safari → Partilhar → Adicionar ao ecrã principal. Abrir a app → ⚙ → colar URL do web app e segredo (ficam só no telefone).

## Uso
- **+ Nova** cria; tocar numa linha edita ou arquiva/desarquiva. Filtros por estado (inclui "arquivadas") e pago.
- Tudo grava primeiro no telefone (IndexedDB). **Sincronizar** (e ao abrir a app) envia pendentes (⏳) e puxa o Sheet. Em conflito ganha o `updated_at` mais recente.
- Se editares uma linha no Sheet, o `updated_at` é atualizado automaticamente.
- Após alterar o script, criar nova versão da implementação.

## Comandos
- `npm test` — testes (`node --test`), incluindo o `Code.gs` real contra um Sheet simulado.
- `npm run serve` — serve em http://localhost:8080.
- `node tools/make-icons.js` — regenera os ícones.
- Teste do segredo: `curl -L -d '{"secret":"X","orders":[]}' -H 'Content-Type: text/plain' <URL>` → `{"ok":false,...}` sem segredo certo.

## Catálogo

Folha `produtos` no mesmo Google Sheet: coluna A = descrição, coluna B = preço unitário, cabeçalho na linha 1. Cada sincronização traz o catálogo para o telefone (substitui o anterior). No campo Modelo aparecem sugestões e o preço total é calculado ao escolher o artigo e ao mudar a quantidade (preço × quantidade). 
### Stock
Se a folha `produtos` tiver uma coluna `Stock` com número, o script gere-a ao sincronizar (a coluna `Reserva` é criada ao lado na primeira vez). Sempre que uma encomenda é criada ou alterada: se houver stock livre (`Stock − Reserva`), reserva até à quantidade pedida; se não houver, não reserva nada (feita por encomenda). Ao marcar paga, o `Stock` desce pelo que estava reservado e a reserva é libertada; desmarcar "pago" ou arquivar uma encomenda não paga repõe. Produtos sem número em `Stock` não são geridos; o nome do modelo é comparado sem distinguir maiúsculas. O que cada encomenda já aplicou fica na coluna `stock_aplicado` da folha `encomendas` (não apagar). Edições manuais no Sheet às encomendas não mexem no stock; encomendas anteriores a esta funcionalidade contam como sem reserva.

Para repor dados errados: corrigir `Stock`, limpar `Reserva` e a coluna `stock_aplicado`.

Depois de alterar o `Code.gs`, criar nova versão da implementação.

## Ordenar e agrupar

Seletor de ordem (recentes, cliente, modelo, estado) e "Agrupar por cliente": cabeçalho com nº de peças e valor em dívida.
