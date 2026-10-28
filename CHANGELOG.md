# TECHVIEW SALDO V1.2

- Carteiras individuais no painel administrativo, com crédito, gasto, taxa de 12%, total, débito registrado e pendência.
- Conciliação do gasto desde o início do dia de ativação, sem repetir valores já debitados. Proteção contra saldo negativo e preservação de gasto pendente.
- Histórico da Meta com datas personalizadas e atalhos de período; consultas históricas não geram débitos.
- Ranking administrativo de leads e compras atribuídos pela Meta: pódio, busca, ordenação, paginação e filtros.
- Um SQL de atualização: `supabase/ATUALIZACAO_UNICA.sql`, para o banco inicial existente ou já atualizado com 002/003. Reexecução completa sem cobrança duplicada.
- Vínculos exclusivos de campanha por cliente, permissões no servidor e RLS preservadas. Pix continua com confirmação manual.

## Ativação

Execute apenas o SQL único, em uma nova consulta no Supabase, com tradução automática desativada. Ele preserva registros existentes e pode conciliar gastos e taxa pendentes conforme a regra autorizada. Não reaplique `schema.sql` nem acrescente os SQLs antigos. Aguarde a Vercel concluir o deploy e confira cada carteira e ranking.

A sincronização financeira ocorre a cada cinco minutos com aba visível; execução contínua sem sessões exige agendamento externo. A taxa de 12% é a regra informada pelo administrador. Métricas/eventos dependem do token e da atribuição/rastreamento da Meta e podem chegar com atraso. O ranking não representa confirmação de venda pelo CRM nem altera saldo.
