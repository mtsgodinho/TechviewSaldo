# TECHVIEW SALDO

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
