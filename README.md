# Cumprimento RJ - Sentença

App web para operação de cumprimento e qualidade de sentenças, migrando a base do AppSheet/Excel para Supabase.

## Campos reais

O app usa como verdade operacional apenas:

- `STATUS_CUMPRIMENTO`
- `STATUS_QUALIDADE`
- `DATA_CUMPRIMENTO`
- `DATA_QUALIDADE`
- `DATA_ULTIMO_EVENTO`

Campos antigos sem underscore e `DATA_PENDENTE` ficam somente no payload bruto de importação para auditoria.

## Rodar local

```bash
npm install
cp .env.example .env.local
npm run dev
```

Sem variáveis Supabase, o app abre com dados de demonstração.

## Banco

Aplique `supabase/migrations/20260427130500_initial_schema.sql` em um projeto Supabase novo.

## Acesso inicial

Com `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` configurados, crie ou promova o admin inicial:

```bash
npm run seed:admin -- seu-email@dominio.com "senha-temporaria" "Seu Nome"
```

Para semear a equipe atual com uma senha temporaria informada no momento da execucao:

```bash
npm run seed:team -- "senha-temporaria"
```

Admins e gestores ativos podem criar novos operadores em `Configurações`.

## Importação

```bash
npm run import:sentencas -- "C:/Users/jur.david/Documents/Base RJ - Sentença.xlsx"
```

Se `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` estiverem configurados, o script importa para o Supabase. Caso contrário, gera `outputs/import-preview.json`.
