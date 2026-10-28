# TECHVIEW SALDO V1.2

Consolidação em 28/10/2026.

- Carteira individual por cliente: crédito adicionado, gasto em anúncios, taxa de 12%, total com taxa, valor já descontado e pendências.
- Saldo líquido negativo destacado quando o gasto supera o crédito, sem transferir dívidas entre clientes.
- Aviso destacado de dívida ao abrir o painel, com botão para gerar o Pix de recarga.
- Conciliação do gasto desde o início do dia de ativação da campanha, incluindo o gasto anterior ao vínculo naquele dia e sem repetir débitos.
- Relatório individual por campanha, com seleção de cliente/campanha e cartões de gasto, **vendas no período**, impressões/cliques, CTR e CPC. Vendas também aparecem na tabela.
- CPA por campanha e período: gasto em anúncios dividido por vendas atribuídas, sem a taxa de 12%. Sem vendas, mostra “—”.
- Filtros Hoje, Ontem, Esta semana, 7, 15 e 30 dias, Este mês e intervalo personalizado. Alterar filtros não altera a carteira.
- Vendas vêm dos eventos de compra atribuídos pela Meta, com a mesma regra do ranking e sem somar agregados e subtipos duplicados. Ausência de compra informa zero; falha de consulta informa erro.
- Ranking administrativo de leads e vendas atribuídos pela Meta, com pódio, busca, ordenação, paginação e filtros de data.
- Mensalidade com preço individual, QR Code/copia e cola Pix, informação de pagamento e confirmação manual pelo administrador. O mês começa na confirmação, separado do crédito de anúncios.
- Meu perfil: edição de nome e telefone, envio e remoção de foto.
- Logo TechView no login e no painel, com fundo tecnológico animado no login e respeito à preferência por movimento reduzido.
- Sair da conta acessível no rodapé do menu e no topo, inclusive em telas pequenas.
- Atalho no celular: botão de instalação no login e menu, orientações para navegadores sem instalação direta e ícones TechView na tela inicial.
- Administração de clientes com exclusão da lista ativa por arquivamento, confirmação de bloqueio, filtros de ativos/arquivados/todos e reativação, preservando o histórico.
- Comprovante PDF TechView para recargas Pix confirmadas, com controle de acesso por cliente e validação do lançamento original, sem novo crédito ou SQL.
- Histórico financeiro, auditoria, permissões por usuário e proteção contra crédito/débito duplicado preservados.

## Ativação

Para bancos existentes, execute somente `supabase/ATUALIZACAO_UNICA.sql` no SQL Editor do Supabase com a tradução automática desativada. O arquivo detecta as migrações 002 a 005 já presentes e instala apenas as ausentes. Preserva registros e não duplica lançamentos ao ser executado integralmente de novo. Não reaplique `schema.sql`. Se o SQL único atualizado já foi aplicado, a inclusão das vendas no relatório não exige outra alteração no banco.

Aguarde o deploy da Vercel chegar a **Ready** e atualize o painel. Validação desta consolidação: 25 testes de regras/banco, cinco testes de interface das campanhas em desktop/celular e compilação de produção aprovados. Testes de interface usam respostas simuladas; não comprovam pagamento bancário ou disponibilidade da Meta em produção.

## Regras de operação

Pix de recarga e mensalidade continuam dependendo da conferência no extrato e confirmação manual. Mensalidade não credita a carteira de anúncios. O vencimento não bloqueia o login nem pausa campanhas. O aplicativo não transfere dinheiro automaticamente para a Meta.

A taxa de 12% é a regra informada pelo administrador. Eventos de venda/leads dependem do rastreamento e da atribuição da Meta e podem sofrer atraso ou revisão. Não representam confirmação de pagamento pelo CRM.

A sincronização financeira ocorre a cada cinco minutos com aba visível. Sem sessões abertas, o cron diário depende de configuração; frequência contínua de cinco minutos exige agendamento externo.
