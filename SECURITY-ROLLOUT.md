# Rollout de seguranca

Este rollout foi separado em preparacao e ativacao para evitar indisponibilidade na farmacia. Nao aplique a ativacao antes de concluir todos os testes de login.

## 1. Backup obrigatorio

Configure `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` somente no ambiente local seguro e execute:

```powershell
npm run backup:production
```

O backup valido fica em `backups/production/<data>/` e precisa ter:

- `manifest.json` com `status: "success"`;
- `manifest.json.sha256`;
- tres arquivos em `database/`;
- todos os objetos em `storage/documentos/`.

Qualquer falha critica produz `status: "failed"` e exit code diferente de zero. Backups `running` ou `failed` nao podem ser restaurados.

## 2. Preparar Auth e RLS sem bloquear o sistema atual

Aplique somente a migration de preparacao:

```powershell
npx supabase db query --linked --file supabase/migrations/20260826100000_prepare_auth_roles_and_rls.sql
```

Ela cria perfis, funcoes e politicas autenticadas. As politicas anonimas atuais continuam funcionando nesta fase.

No Dashboard do Supabase, em Authentication > Users, crie os usuarios com e-mail confirmado. Depois associe cada usuario a um perfil. O comando inicia em dry-run:

```powershell
npm run auth:provision -- --email admin@empresa.com --role admin --name "NOME DO ADMIN"
npm run auth:provision -- --email admin@empresa.com --role admin --name "NOME DO ADMIN" --apply --confirm PROVISION_USER_ROLE

npm run auth:provision -- --email caixa@empresa.com --role atendente --name "NOME DO ATENDENTE"
npm run auth:provision -- --email caixa@empresa.com --role atendente --name "NOME DO ATENDENTE" --apply --confirm PROVISION_USER_ROLE
```

## 3. Testar a aplicacao antes da ativacao

Publique primeiro uma Preview Deployment da branch de seguranca, nunca a `main` diretamente.

Teste como atendente:

- login e logout;
- busca e abertura de pacientes;
- cadastro de paciente;
- nova receita, documento, procuracao e cupom;
- ausencia da aba Admin;
- acesso direto a `/admin` redirecionado para sem acesso.

Teste como admin:

- todos os testes do atendente;
- acesso ao Admin e paineis;
- edicao de cadastro sem historico fiscal;
- bloqueios existentes de exclusao e de alteracao do historico.

## 4. Ativar seguranca em producao

Escolha um horario de baixo movimento. Confirme antes que existe ao menos um perfil `admin` ativo e que o login na Preview funciona.

```powershell
npx supabase db query --linked --file supabase/rollout/activate-auth-and-private-storage.sql
```

O SQL aborta a transacao se nao houver administrador ativo. Quando conclui, ele:

- remove acesso anonimo das tres tabelas;
- remove politicas publicas de leitura, upload, update e delete do Storage;
- revoga privilegios do papel `anon`;
- torna o bucket `documentos` privado.

Imediatamente depois, publique a mesma revisao validada na Vercel e execute `supabase/rollout/verify-auth-security.sql`.

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

Novos uploads gravam somente o path do objeto no banco. O helper `src/lib/storage.ts` gera URLs assinadas de curta duracao. URLs publicas antigas do bucket sao convertidas para o path correspondente e assinadas sem modificar o historico.

Validacao:

1. Abra receita, documento, procuracao e cupom estando autenticado.
2. Copie uma URL publica antiga e abra em janela anonima; ela nao deve entregar o arquivo depois da ativacao.
3. Confirme que a URL assinada abre durante a sessao e expira depois.
4. Confirme que atendente pode ler e inserir, mas nao atualizar ou excluir objetos.

## 7. Rollback emergencial

Se a ativacao causar indisponibilidade e nao for possivel corrigir imediatamente, o arquivo `supabase/rollout/emergency-rollback-auth.sql` restaura temporariamente o acesso anterior. Ele reabre dados sensiveis e deve ser usado apenas como medida emergencial, seguido de nova auditoria e reativacao da seguranca.
