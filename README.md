# TECHVIEW SALDO — V1.2

Aplicativo de controle de crédito interno para anúncios. Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth/PostgreSQL e deploy na Vercel. Pix estático BR Code com confirmação **manual**. Sem gateways, saques, transferências ou integração Meta Ads.

## Ambiente de desenvolvimento

Requer Node.js 22 ou 24 e npm. Use o checkout existente; cada tarefa de nuvem já é isolada, não é necessário criar worktrees.

```sh
cd /workspace/TechviewSaldo
npm ci
cp .env.example .env.local # somente se o arquivo ainda não existir
npm run dev
```

Sem variáveis, a aplicação mostra uma tela explícita de configuração e bloqueia o login. Não há saldo fictício, credenciais padrão ou bypass de autenticação.

## Conectar o Supabase

1. Crie um projeto Supabase. No SQL Editor, execute `supabase/schema.sql` **uma vez em um projeto novo**. O script cria tabelas, RLS, índices e funções transacionais; não deve ser reaplicado como migração incremental.
2. Em Authentication → Providers → Email, **desative novos cadastros públicos** (Allow new users to sign up). Não há tela de cadastro público. Mantenha o provedor de e-mail/senha habilitado.
3. Em Authentication → Users, crie seu usuário administrador com e-mail confirmado e senha forte. Copie o UUID desse usuário.
4. Execute o SQL abaixo substituindo o UUID e o nome. Isso é uma ação inicial pelo SQL Editor, nunca disponível no frontend:

```sql
insert into public.profiles (id, name, role, active)
values ('UUID-DO-USUARIO-ADMIN', 'Seu nome', 'admin', true);
```

5. Configure com segurança as variáveis de `.env.example` no ambiente local/nuvem e na Vercel:

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL HTTPS do projeto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública anon do projeto; RLS continua obrigatória |
| `SUPABASE_SERVICE_ROLE_KEY` | Segredo exclusivo do servidor para criar usuários, redefinir senhas e gerar solicitações Pix |

A service role nunca usa prefixo `NEXT_PUBLIC_` e não deve ser enviada ao navegador, commitada ou informada em chat. Use os campos seguros das configurações do ambiente. Para acesso neste ambiente de nuvem, permita também o hostname exato `SEU-PROJETO.supabase.co` na rede. Não há credenciais pré-configuradas.

6. Reinicie o servidor após configurar as variáveis. Entre como administrador, salve a chave Pix, recebedor, cidade, banco e valor mínimo em **Configurações Pix**. Nubank, Next e Outro são apenas referências da conta recebedora.
7. Cadastre os clientes pelo painel com senha inicial de pelo menos 12 caracteres. Compartilhe o acesso por canal seguro. Para recuperação de acesso, use **Clientes → Gerenciar → Redefinir acesso**. Inativar um cliente bloqueia as leituras e operações no banco mesmo com sessão existente.

## Fluxos

**Cliente:** saldo → adicionar saldo → valor em reais com até duas casas → QR Code/copia e cola → conferir e pagar no banco → informar pagamento → aguardar conferência. Informar pagamento **não adiciona crédito**. Consulte solicitações anteriores em Minhas recargas, incluindo o payload e recebedor originais.

**Administrador:** confira o Pix no extrato real → abra a solicitação → marque a conferência → confirme ou rejeite. O banco registra responsável/data, credita e cria a movimentação na mesma transação. Cliques repetidos não duplicam o crédito. Solicitações rejeitadas/confirmadas são finais; para corrigir contabilmente, registre crédito/débito/estorno com motivo.

**Anúncios:** Clientes → Gerenciar → Ajustar saldo / Meta Ads → tipo Recarga Meta Ads → valor, motivo e data. A operação desconta crédito disponível sem permitir saldo negativo. Crédito manual, débito e estorno também exigem motivo e registram saldos anterior/posterior. Estorno significa devolução de crédito interno, sem transferência bancária.

Os painéis consultam novos dados a cada 30 segundos enquanto a aba está visível e após operações. O saldo representa crédito para custear anúncios; o aplicativo não custodia dinheiro.

## Segurança e integridade

- Cookies de sessão geridos pelo Supabase SSR, com renovação no proxy do Next.js.
- Papéis e status lidos do banco; nenhuma permissão é aceita de parâmetros do navegador.
- RLS limita clientes às próprias linhas. Não há permissão direta de INSERT/UPDATE/DELETE para usuários autenticados nas tabelas financeiras.
- RPCs administrativas validam o administrador ativo. Solicitações Pix são criadas exclusivamente pelo servidor, com snapshot do recebedor e controle de versão das configurações.
- Valores em centavos inteiros; limite por operação de R$ 999.999,99. Valor mínimo Pix configurável.
- `FOR UPDATE` serializa a carteira e a solicitação. Restrições únicas de solicitação/operação e transações evitam duplicidades; falhas revertem todo o lançamento.
- Histórico financeiro sem edição ou exclusão pelo app. Auditoria de cadastro, edição, redefinição de acesso, configurações e lançamentos.
- Origem HTTP validada nas mutações para impedir requisições entre sites.
- QR Code contém campos EMV Pix, valor, txid alfanumérico de até 25 caracteres e CRC16/CCITT-FALSE. Não é um QR Code de texto avulso.
- Não é possível verificar automaticamente que a chave pertence ao recebedor informado. Teste com sua chave real e confira nome/valor no aplicativo bancário antes de disponibilizar aos clientes.

## Validação

```sh
npm run test
npm run typecheck
npm run build
npm run start
```

Os testes unitários verificam o vetor conhecido de CRC, campos TLV/EMV, centavos e rejeição de valores inválidos. O teste de banco executa o SQL real em PostgreSQL WASM (PGlite) **somente em memória para testes**, com roles e `auth.uid()` simulados: isolamento RLS, negação de escrita direta, confirmação idempotente, informação sem crédito, Meta Ads, rollback por saldo insuficiente, auditoria e cliente inativo. O banco da aplicação é exclusivamente Supabase.

Testes de interface (sem variáveis Supabase, para verificar o estado de configuração):

```sh
# Com Chromium instalado no sistema:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npx playwright test
# Em outra máquina, instale o navegador pelo Playwright e informe o caminho do executável.
```

Os testes verificam login desktop/celular, ausência de transbordamento horizontal, erros JavaScript e bloqueio de origem não confiável. Também montam as telas autenticadas isoladamente com fixtures e respostas de API simuladas, apenas dentro do teste: escolha de valor com centavos, geração/exibição do QR, informação de pagamento sem crédito, gestão de cliente, lançamento Meta Ads e teste de configurações Pix. Essas fixtures não existem em rotas ou contas da aplicação. Autenticação hospedada, concorrência entre conexões reais, políticas no projeto remoto e pagamento Pix real precisam de validação com seu Supabase e banco antes de produção. Os testes locais não comprovam esses serviços externos.

## Deploy na Vercel

1. Envie este projeto para seu repositório GitHub e importe-o na Vercel com preset **Next.js**, diretório raiz do projeto, instalação `npm ci` e build `npm run build`.
2. Use Node.js 22 ou 24. Configure as três variáveis da tabela para os ambientes necessários; nunca publique a service role.
3. No Supabase, configure Site URL com o domínio HTTPS publicado e mantenha desativado o cadastro público. Sem callbacks externos neste fluxo de senha.
4. Faça deploy e teste com um administrador e dois clientes: isolamento entre contas, recarga com centavos, indicação sem crédito, dupla confirmação, débito maior que saldo, inativação e recuperação de acesso.
5. Faça uma recarga pequena com chave real: abra o QR Code no banco, confira recebedor e valor, pague e somente então confirme manualmente pelo painel.

Nenhum deploy, projeto Supabase, usuário remoto ou pagamento é criado automaticamente por estes arquivos. Configure backups e retenção adequados no Supabase antes de usar dados reais.

## Integração Meta Ads (migração 002)

A regra financeira agora é **gasto da campanha**, individual por cliente: R$ 100 de crédito e R$ 30 de gasto novo deixam R$ 70 disponíveis. Enviar dinheiro para a conta compartilhada da Meta não é um débito adicional. Pix continua com confirmação manual.

### Ativação em um banco já existente

1. Faça backup e execute **somente** `supabase/migrations/002_meta.sql` uma vez no SQL Editor. A migração é transacional, cria a tabela/RLS e funções da integração e substitui a função de ajuste com proteção contra lançamento Meta duplicado. Não execute novamente `schema.sql` em produção.
2. No servidor/Vercel, configure `META_ACCESS_TOKEN` com acesso `ads_read`, `META_AD_ACCOUNT_ID` com os números da conta (sem `act_`) e `CRON_SECRET` com um segredo aleatório de pelo menos 32 caracteres. Nenhum usa `NEXT_PUBLIC_`. Não guarde tokens no Git ou em chat. O token da ferramenta de desenvolvedor pode expirar; para operação contínua, configure uma credencial de usuário do sistema com acesso à conta e acompanhe revogações/expiração.
3. Faça deploy, entre como administrador e abra **Campanhas Meta → Buscar campanhas da Meta**. Escolha campanha e cliente e confirme a propriedade exclusiva. Uma campanha não pode pertencer a mais de um cliente. Campanhas sem vínculo nunca alteram carteiras. Trocar a conta do servidor não transfere vínculos.
4. Ao vincular, o sistema registra o gasto, impressões e cliques já informados naquele dia como referência inicial. A partir daí só a diferença nova entra nas métricas e nos débitos. O vínculo é permanente nesta versão para preservar a contabilidade. Para corrigir um vínculo equivocado, não reutilize a campanha: é necessária uma migração revisada com conciliação.
5. Clique em **Atualizar métricas** e valide o primeiro lançamento com o relatório da Meta. O saldo pode aparecer reservado se houver gasto pendente de desconto; valores pendentes são conciliados na próxima sincronização após recarga.

### Frequência e limitações

- Com uma sessão aberta em aba visível, o app solicita sincronização ao entrar e a cada **5 minutos**. O backend evita consultas repetidas dentro de cinco minutos; o administrador pode atualizar manualmente. O painel financeiro relê dados a cada 30 segundos.
- O cron de `vercel.json` roda **uma vez ao dia, às 09h de São Paulo**, compatível com a frequência diária do plano Hobby. Requer `CRON_SECRET`. O endpoint protegido é `GET /api/cron/meta`, com cabeçalho `Authorization: Bearer <CRON_SECRET>`. Sem segredo, retorna 401 e não faz lançamentos.
- Para sincronização a cada 5 minutos **mesmo sem ninguém com o site aberto**, configure um agendador externo com HTTPS e cabeçalho secreto (por exemplo, um plano gratuito que suporte essa frequência) para chamar esse endpoint. O cron diário sozinho não garante atualização em cinco minutos. Não coloque o segredo na URL. O app não configura contas externas nem presume a disponibilidade de serviços gratuitos.
- O aviso de **saldo disponível ≤ R$ 20** aparece para cada cliente com botão de recarga. Não pausa campanhas e não representa o saldo/cobrança da conta Meta.
- Relatórios da Meta têm atraso e podem sofrer revisões. Referência inicial exclui o gasto já informado ao vincular, mas eventos anteriores reportados com atraso podem entrar posteriormente; revise a conciliação inicial. Gasto negativo/reduzido não gera estorno automático: o maior gasto observado é mantido e a campanha mostra aviso para revisão. Faça estorno manual documentado quando necessário.
- A API usa a versão v24.0, conta BRL e fuso America/Sao_Paulo. Consultas usam intervalo fixo desde o dia de ativação, dentro da janela histórica permitida pela Meta; campanhas muito antigas requerem revisão/arquivamento antes do limite de retenção da API. Métricas disponíveis nesta versão: gasto, impressões, cliques, CTR e CPC desde o vínculo. Alcance, leads e vendas não são inferidos de cliques.
- Cada atualização bloqueia campanha e carteira em transação. Repetição ou resposta antiga não duplica o débito. Se a Meta gastar além do crédito, o banco debita somente o disponível e preserva o restante como gasto pendente, sem saldo negativo. Recargas posteriores conciliam esse pendente. O aplicativo não interrompe a veiculação na Meta.
- Tokens permanecem no servidor. RLS entrega ao cliente somente seus vínculos/métricas. Apenas o backend pode criar vínculos e aplicar observações; o cliente não informa valores de gasto. Ações automáticas registram o administrador que ativou o vínculo e a origem Meta na auditoria.
- Não registre abastecimentos como gasto manual para clientes integrados: isso descontaria duas vezes. A RPC rejeita o tipo Meta manual se o cliente tem campanhas vinculadas. Outros ajustes continuam exigindo motivo e auditoria.

### Verificações antes de liberar

`npm run test` executa também casos de baseline, gasto por cliente, repetição, resposta fora de ordem, saldo insuficiente, conciliação após crédito e RLS da integração em PostgreSQL de teste. Nunca execute fixtures contra produção. Compare a consulta real de gastos com a Meta e faça o vínculo de cada campanha conscientemente; instalar a integração não atribui campanhas automaticamente.

### Atualização 003: histórico, dia de ativação e taxa de 12%

Execute `supabase/migrations/003_meta_activation_day.sql` **uma vez após a 002**, no SQL Editor, com tradução automática desativada. Não reaplique `schema.sql`. A migração adiciona o detalhamento de principal/taxa, atualiza o cálculo transacional e concilia o gasto do dia de ativação dos vínculos existentes de 28/10/2026, conforme autorização. Não cobra dias anteriores à ativação. Faz débito apenas da diferença que ainda não foi paga; se faltar crédito, preserva a pendência. Tudo ocorre na mesma transação. Não é uma migração para reexecução: repetir o arquivo gera erro de coluna existente; repetir uma sincronização é idempotente.

A taxa de **12% foi informada pelo administrador como regra deste negócio**, não é descoberta ou validada pela API. É calculada sobre o gasto acumulado contabilizável de cada campanha, em centavos, arredondando meio centavo para cima; não se arredonda a taxa isoladamente em cada atualização. Total devido = gasto + taxa. Cada lançamento guarda valor de anúncios, taxa, saldos anterior/posterior e auditoria. Débitos já feitos são preservados e conciliados, sem cobrar tudo novamente.

Exemplo: R$ 90 de crédito, R$ 13,53 de gasto, R$ 1,62 de taxa → total de R$ 15,15 e saldo de R$ 74,85. Se R$ 0,18 já foram debitados, a migração debita somente R$ 14,97. Gasto além do crédito fica pendente, sem saldo negativo; crédito posterior liquida principal e depois taxa. O aviso de R$ 20 usa o saldo individual após reservar pendências.

A visão geral administrativa agora destaca um card por cliente com crédito adicionado, gasto, taxa, total, valor já descontado, pendência e saldo disponível. O detalhe do cliente e seu próprio login mostram a mesma carteira individual. Nenhum saldo é transferido entre clientes.

Os relatórios têm Hoje (padrão), Ontem, Esta semana (segunda a domingo), 7, 15 e 30 dias (incluem hoje), Este mês e datas personalizadas, limitadas aos últimos 36 meses e à disponibilidade da Meta. Fuso America/Sao_Paulo. Clientes consultam apenas campanhas vinculadas ao próprio perfil. O histórico pode anteceder o vínculo: ele não subtrai a referência inicial e não gera débitos ao trocar filtros. Gasto em anúncios, taxa estimada do período e total com taxa aparecem separados. A taxa do relatório é arredondada por campanha/período; a carteira usa o acumulado contabilizável desde a ativação, portanto diferenças de um centavo entre recortes são possíveis e não são novos lançamentos.

O bloco Crédito e gasto das campanhas mostra valores financeiros acumulados desde a ativação, sem mudar com o filtro histórico. Erros de relatório aparecem como indisponibilidade, sem apresentar zeros falsos ou resultados do período anterior. Depois de aplicar a 003 e publicar o código, compare os saldos com o histórico antes de vincular novas campanhas.

### SQL único para atualizar o ambiente existente

Para instalar de uma vez as mudanças pendentes, use **somente `supabase/ATUALIZACAO_UNICA.sql`**, no SQL Editor com tradução automática desativada. Ele pressupõe que o banco inicial já existe, detecta a presença das migrações Meta 002/003 e executa apenas as ausentes, dentro de uma transação com bloqueio de atualização. Preserva clientes, Pix, carteiras, vínculos e histórico. A primeira aplicação pode conciliar débitos pendentes de gasto do dia e taxa de 12%, conforme a regra autorizada. Reexecutar o arquivo completo não duplica lançamentos. Não execute `schema.sql` novamente nem cole os arquivos antigos junto com ele. O resultado final deve mostrar “Atualização concluída”. Foi testado a partir do banco inicial, da migração 002 e da 003, com repetição sem alteração adicional dos saldos.

### Ranking de vendas atribuídas pela Meta

A aba **Ranking de vendas** fica no painel administrativo. A API `/api/ranking` exige administrador ativo no servidor e consulta somente campanhas vinculadas aos clientes. Ela não usa RPCs financeiras nem altera saldo. Dados ao vivo da Meta com filtros Hoje, Ontem, Esta semana, 7/14/15/30/90 dias, Este mês, Todos (janela consultável de até 36 meses) e datas personalizadas. Há pódio por vendas, totais, busca, ordenação por vendas/leads/razão entre eventos e páginas de 25 clientes. O ranking não exige tabelas novas: o SQL único prepara os vínculos já utilizados pela integração.

Leads vêm da primeira família retornada entre `lead`, `omni_lead`, `offsite_conversion.fb_pixel_lead` e `onsite_conversion.lead_grouped`. Vendas vêm de `omni_purchase`, `purchase`, `offsite_conversion.fb_pixel_purchase` ou `onsite_conversion.purchase`, nessa prioridade. Um agregado e seus subtipos nunca são somados entre si, evitando duplicar conversões. Resultados de campanhas distintas do mesmo cliente são somados. A consulta usa `actions`, `use_unified_attribution_setting=true` e `action_report_time=impression`, respeitando a atribuição dos conjuntos de anúncios e agrupando pela data da impressão. Para comparar com o Gerenciador, use as mesmas datas, campanhas, eventos e atribuição.

Os números são eventos **atribuídos**, e não confirmação de pagamento ou venda do CRM. Pixel/CAPI/formulários precisam registrar os eventos corretos e fazer deduplicação de eventos nas próprias fontes. Cliques ou conversas iniciadas não viram leads por inferência. Sem evento de lead ou compra no período, a interface mostra contagem zero e identifica a ausência do evento; falha de acesso/consulta aparece como erro, sem fabricar números nem manter o pódio do período anterior. A razão vendas/leads não é uma coorte do funil, pode superar 100% e fica indefinida quando não há leads. A Meta pode revisar ou retornar atribuições fracionárias. Nenhum cálculo de imposto ou carteira é alterado pelo ranking.

### Saldo líquido negativo na interface

A carteira agora exibe o líquido **crédito ainda não consumido − gasto pendente (incluindo 12%)**, sem limitar o resultado a zero. Exemplo: crédito zero e R$ 21,97 pendentes → saldo devedor de −R$ 21,97, em vermelho, na visão geral, lista de clientes, detalhe e login do próprio cliente. A recarga abate primeiro essa dívida; apenas o excedente constitui crédito líquido. A soma não duplica os gastos já debitados. Essa é uma mudança de apresentação usando a dívida já registrada, sem novo SQL nem alteração dos lançamentos existentes; o livro de crédito e a pendência continuam separados no banco, com conciliação transacional. O saldo líquido é o mesmo antes e depois de liquidar uma pendência com crédito suficiente ou parcial.

Ao abrir o painel com saldo líquido negativo, o cliente recebe um aviso modal destacado com o valor devido. **Fazer recarga via Pix** gera diretamente o QR Code com o maior valor entre a dívida exibida e o mínimo Pix configurado, informado antes do pagamento. **Escolher outro valor** abre o formulário normal; também é possível fechar e consultar o painel. O aviso aparece uma vez por abertura e reaparece se o saldo voltar a ficar negativo depois de regularizado. Não interrompe um pagamento já aberto. Gerar ou informar Pix não altera o saldo: continua dependendo de confirmação manual.

### Meu perfil, fotos e identidade TechView

A aba **Meu perfil** permite ao cliente e administrador editar apenas seu próprio nome e telefone, visualizar o e-mail de acesso e enviar/remover uma foto. A senha e a troca de e-mail continuam sob o fluxo de acesso do Supabase/administrador. A edição não aceita papel, status, ID de outro usuário ou dados de carteira.

Aplique uma vez `supabase/migrations/004_profiles_brand.sql`, ou use o **SQL único atualizado** `supabase/ATUALIZACAO_UNICA.sql`, que detecta as atualizações já presentes e preserva os registros. A 004 cria o bucket privado `techview-profile-media`, os campos de perfil e a configuração pública da marca. Ela não modifica saldos. O SQL único só concilia a regra financeira antiga quando a migração financeira ainda está ausente; não repete os lançamentos de uma 003 já completa.

Fotos são processadas no servidor com Sharp, sem aceitar SVG ou animações: JPG/PNG/WebP de até 4 MB e 4096 × 4096 pixels. São reencodificadas em WebP, com remoção de metadados, e recortadas para 512 × 512 para avatar. O bucket é privado: as fotos só passam pela rota autenticada com RLS (próprio usuário ou administrador autorizado a ler o perfil). Upload e alteração da referência usam o usuário autenticado, nunca um ID informado no formulário. A remoção do arquivo anterior ocorre só depois da nova referência ser salva. Falhas podem deixar um objeto órfão sem exposição pública; não apague objetos de outro usuário.

**Marca TechView** aparece somente no Meu perfil do administrador. Envie o arquivo original da logo para preservá-lo fielmente, sem redesenho. O servidor preserva a proporção e gera uma versão WebP de até 1536 × 1024. A mesma imagem aparece grande no login e no menu interno para todos. A logo é pública por definição; não envie documentos ou dados pessoais nesse campo. Enquanto a arte não tiver sido enviada, há a marca textual TechView como alternativa. As imagens mostradas no chat não são copiadas automaticamente para o repositório; o upload utiliza o arquivo original do computador.

O login inclui fundo tecnológico em CSS com grade, circuitos e luzes em movimento lento, sem vídeo ou dependência externa. As animações são desativadas quando o dispositivo solicita movimento reduzido. O layout e os formulários de perfil foram preparados para desktop e celular.

O menu lateral mantém **Sair da conta** e o perfil fixos na área visível. Em telas baixas, apenas a lista de navegação ganha rolagem. Há também **Sair** no topo, acessível sem abrir o menu no celular. Ambas as opções usam o mesmo encerramento de sessão e retornam à tela de login para trocar de usuário.

### Mensalidade por cliente, com Pix próprio

A aba **Mensalidade** permite ao administrador definir um preço individual e gerar um Pix com esse valor; o cliente também gera ou reabre a cobrança pelo próprio login. O valor vem do banco, não de parâmetros do navegador. O Pix usa a mesma chave configurada para recebimento, com identificador iniciado por M e registro separado de recargas de anúncios. Existe no máximo uma cobrança aguardando/informada por cliente; repetir a geração reabre o mesmo Pix. Alterar o preço não modifica cobranças ou períodos já registrados: para substituir uma cobrança ainda pendente, rejeite-a antes de gerar outra.

O cliente paga e clica **Já paguei a mensalidade**; isso apenas informa o pagamento. O administrador confere o extrato e usa **Confirmar Pix e ativar um mês** dentro da aba Mensalidade. O mês começa na data/hora da confirmação, não na geração do QR Code nem no aviso do cliente. Confirmações repetidas não criam outro período. A ativação e a marcação da cobrança confirmada são atômicas, com auditoria. Cobranças rejeitadas não ativam a mensalidade.

A validade termina no mesmo dia e horário do próximo mês, no fuso America/Sao_Paulo. Em meses sem aquele dia, usa o último dia (31/01 → 28/02, ou 29/02 em ano bissexto). A tela usa a hora informada pelo servidor e atualiza a cada minuto enquanto visível; o banco valida o vencimento de forma autoritativa. Uma nova cobrança fica disponível depois do vencimento. Não há renovação automática, débito da carteira, taxa adicional de anúncios sobre a mensalidade ou crédito de anúncios com o pagamento. O vencimento apenas muda o status; não bloqueia login nem pausa campanhas automaticamente.

Para ativar, execute o **SQL único atualizado** `supabase/ATUALIZACAO_UNICA.sql`, que detecta e instala a migração `005_monthly_fees.sql` quando ausente. Também é possível aplicar apenas a 005 uma vez no banco já atualizado. Não reaplique `schema.sql`. O histórico das mensalidades fica nas tabelas `monthly_settings`, `monthly_requests` e `monthly_cycles`, com RLS: cliente lê somente seus registros; valores, confirmação e rejeição exigem administrador ativo. Não foram adicionados gateways nem APIs de pagamento.

### Relatório individual de campanhas

Em Campanhas Meta, os indicadores agora se referem à campanha selecionada. Administradores podem escolher cliente e campanha; clientes só enxergam suas próprias campanhas. O detalhe de um cliente já restringe as escolhas a ele. Gasto, taxa, total com taxa, impressões, cliques, CTR e CPC seguem a mesma campanha e período. A API cruza o ID selecionado com os vínculos sob RLS antes de consultar a Meta. Trocar a seleção consulta o relatório sem alterar carteira; a sincronização financeira continua conciliando cada campanha vinculada individualmente.
