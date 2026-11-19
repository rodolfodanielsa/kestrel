# Factory rules — encomendas

max_rounds: 2

## Reviewers
- spec (sonnet) — every requirement of specs/encomendas-pwa.md met, with evidence
- code (sonnet) — correctness, simplicity, plain HTML/JS, no unnecessary dependencies
- security (sonnet) — secret never in repo or served files, input validation, no XSS when rendering order text

## Verify
Run any tests the project defines (node --test or equivalent); for UI, run the PWA locally and exercise create/edit/filter/archive offline and sync against a mocked Apps Script endpoint.

## Always escalate
- Anything touching the Apps Script auth/secret handling
- Any change to the Sheet column schema
