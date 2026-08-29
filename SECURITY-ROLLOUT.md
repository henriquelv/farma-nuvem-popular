# Rollout de seguranca

## Estado do Auth em producao (2026-08-28)

- login compartilhado da farmacia: `otavio`;
- senha minima de 12 caracteres, com minuscula, maiuscula e numero exigidos pelo Supabase;
- simbolo exigido adicionalmente pelo app e pelos scripts administrativos;
- cadastro publico e usuarios anonimos desativados;
- reautenticacao exigida para troca sensivel de senha;
- sessao limitada a 12 horas de inatividade e 24 horas no total;
- recuperacao preparada nas rotas `/recuperar-senha` e `/nova-senha`;
- envio de recuperacao depende de e-mail real na conta e SMTP de producao.

O bloqueio progressivo do frontend reduz repeticoes acidentais e ataques simples. O rate limit nativo do Supabase permanece como controle do servidor. Para protecao automatizada adicional, configure Cloudflare Turnstile no Supabase e passe o token CAPTCHA nas chamadas Auth.

Este rollout foi separado em preparacao e ativacao para evitar indisponibilidade na farmacia. Nao aplique a ativacao antes de concluir todos os testes de login.

## 1. Backup obrigatorio

Configure `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` somente no ambiente local seguro e execute:

```powershell
npm run backup:production
```

O backup valido fica em `backups/production/<data>/` e precisa ter:

- `manifest.json` com `status: "success"`;
- `manifest.json.sha256`;
- os tres arquivos principais em `database/` e, apos a migracao multi-farmacia, tambem `farmacias.json` e `user_profiles.json`;
- todos os objetos em `storage/documentos/`.

Qualquer falha critica produz `status: "failed"` e exit code diferente de zero. Backups `running` ou `failed` nao podem ser restaurados.

## 2. Preparar Auth e RLS sem bloquear o sistema atual

Aplique somente a migration de preparacao:

```powershell
npx supabase db query --linked --file supabase/migrations/20260826100000_prepare_auth_roles_and_rls.sql
npx supabase db query --linked --file supabase/migrations/20260827120000_add_pharmacy_tenancy.sql
```

As migrations criam perfis e politicas autenticadas, preservam a tabela legada `farmacias` e vinculam todos os registros anteriores a uma farmacia principal. As politicas anonimas atuais continuam funcionando nesta fase.

Crie uma conta compartilhada por farmacia. O login nao precisa ser um e-mail e a senha deve ter no minimo 12 caracteres. O comando inicia em dry-run e nunca exibe a senha no relatorio:

```powershell
npm run auth:provision-pharmacy -- --legacy --login farmacia-principal --pharmacy-name "FARMACIA PRINCIPAL" --password "SENHA FORTE"
npm run auth:provision-pharmacy -- --legacy --login farmacia-principal --pharmacy-name "FARMACIA PRINCIPAL" --password "SENHA FORTE" --apply --confirm CREATE_PHARMACY_LOGIN

npm run auth:provision-pharmacy -- --login farmacia-centro --pharmacy-name "FARMACIA CENTRO" --password "OUTRA SENHA FORTE"
npm run auth:provision-pharmacy -- --login farmacia-centro --pharmacy-name "FARMACIA CENTRO" --password "OUTRA SENHA FORTE" --apply --confirm CREATE_PHARMACY_LOGIN
```

`--legacy` e usado apenas uma vez para a farmacia que ja possui os dados atuais. Novas farmacias nunca usam essa flag. Cada conta criada recebe administracao completa somente sobre os seus proprios pacientes.

## 3. Testar a aplicacao antes da ativacao

Publique primeiro uma Preview Deployment da branch de seguranca, nunca a `main` diretamente.

Teste com a conta da farmacia:

- login e logout;
- busca e abertura de pacientes;
- cadastro de paciente;
- nova receita, documento, procuracao e cupom;
- acesso ao Admin e paineis;
- edicao de cadastro sem historico fiscal;
- bloqueios existentes de exclusao e de alteracao do historico.

Teste de isolamento com uma segunda farmacia vazia:

- a lista de pacientes deve iniciar vazia;
- CPF existente na farmacia principal pode ser cadastrado na segunda farmacia;
- a segunda farmacia nao pode abrir a URL ou o ID de paciente da primeira;
- os novos paths de Storage devem iniciar com o UUID da farmacia autenticada.

## 4. Ativar seguranca em producao

Escolha um horario de baixo movimento. Confirme antes que existe ao menos uma farmacia ativa com perfil `admin` e que o login na Preview funciona.

Para evitar indisponibilidade, publique primeiro a revisao validada na Vercel. Enquanto as politicas anonimas ainda existem, o frontend novo ja exige login, mas uma falha de sessao nao bloqueia as operacoes do banco durante a troca. Confirme o login no dominio de producao e so entao execute:

```powershell
npx supabase db query --linked --file supabase/rollout/activate-auth-and-private-storage.sql
```

O SQL aborta a transacao se nao houver administrador ativo. Quando conclui, ele:

- remove acesso anonimo das tres tabelas;
- remove politicas publicas de leitura, upload, update e delete do Storage;
- revoga privilegios do papel `anon`;
- torna o bucket `documentos` privado.

Imediatamente depois, execute `supabase/rollout/verify-auth-security.sql` e repita no dominio de producao: login, busca, abertura de documento e logout.

## 5. Restore

O restore completo sempre inicia em dry-run e nunca sobrescreve registro ou arquivo divergente:

```powershell
npm run restore:production -- --manifest backups/production/<data>/manifest.json
```

O restore real deve ser testado primeiro em um projeto Supabase separado. Ele exige duas flags:

```powershell
npm run restore:production -- --manifest backups/production/<data>/manifest.json --apply --confirm RESTORE_PRODUCTION_BACKUP
```

Ordem de restauracao: `clientes`, `vendas`, `vendas_documentos` e Storage. A execucao e idempotente para itens identicos, recusa conflitos e valida novamente IDs e hashes apos gravar.

O restore legado das copias feitas pelo otimizador tambem inicia em dry-run. A aplicacao exige `--apply --confirm RESTORE_STORAGE_BACKUP`.

## 6. Documentos privados

Novos uploads gravam somente o path `<farmacia_id>/<tipo>/<arquivo>` no banco. O helper `src/lib/storage.ts` gera URLs assinadas de curta duracao. A farmacia principal mantem leitura temporaria dos paths publicos antigos sem modificar o historico; farmacias novas nunca recebem acesso a esses paths.

Validacao:

1. Abra receita, documento, procuracao e cupom estando autenticado.
2. Copie uma URL publica antiga e abra em janela anonima; ela nao deve entregar o arquivo depois da ativacao.
3. Confirme que a URL assinada abre durante a sessao e expira depois.
4. Confirme que atendente pode ler e inserir, mas nao atualizar ou excluir objetos.

## 7. Rollback emergencial

Se a ativacao causar indisponibilidade e nao for possivel corrigir imediatamente, o arquivo `supabase/rollout/emergency-rollback-auth.sql` restaura temporariamente o acesso anterior. Ele reabre dados sensiveis e deve ser usado apenas como medida emergencial, seguido de nova auditoria e reativacao da seguranca.

## 8. Recuperacao de senha por e-mail

O login compartilhado da farmacia usa um endereco tecnico que nao recebe mensagens. Por isso, a recuperacao passa pela Edge Function `request-password-recovery`: ela confirma `login + e-mail de recuperacao`, gera o link com Supabase Auth e entrega a mensagem pelo Brevo. A resposta publica nao informa se a conta existe.

Antes da ativacao:

1. Cadastre o e-mail real em `Administrador > Minha conta`.
2. Crie uma conta gratuita no Brevo e verifique um endereco remetente.
3. Gere uma API key transacional e um segredo aleatorio com pelo menos 32 bytes.
4. Instale os secrets somente no Supabase:

```powershell
npx supabase secrets set --project-ref edtscwxgpyeqmqtpisdz BREVO_API_KEY="..." EMAIL_FROM_ADDRESS="remetente@dominio.com" EMAIL_FROM_NAME="Farma Nuvem" APP_ORIGIN="https://farma-nuvem-popular.vercel.app" RECOVERY_RATE_LIMIT_SECRET="..."
```

5. Aplique `supabase/migrations/20260829120000_add_password_recovery_rate_limit.sql` e implante a funcao sem verificacao JWT, pois a rota precisa funcionar antes do login:

```powershell
npx supabase functions deploy request-password-recovery --project-ref edtscwxgpyeqmqtpisdz --no-verify-jwt
```

6. Teste a entrega e somente depois defina `VITE_PASSWORD_RECOVERY_ENABLED=true` na Vercel.

O endpoint permite no maximo 5 tentativas por combinacao de conta/e-mail e 20 por origem em 15 minutos. Os identificadores sao armazenados apenas como hashes e sao eliminados apos 24 horas.
