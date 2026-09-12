-- Row Level Security: negar por padrao, e nomear quem pode o que.
--
-- Ate aqui a unica separacao de poder era o papel so-leitura criado a mao no
-- Neon, fora do repositorio. Se ele sumisse, ninguem notava. Isto poe a regra
-- na migracao: o Postgres passa a recusar o que a aplicacao prometia recusar
-- sozinha.
--
-- Alcance honesto: o painel e single-tenant, entao a politica da aplicacao e
-- `USING (true)` — todo mundo la dentro ve tudo. O que o RLS protege aqui e a
-- fronteira ENTRE papeis: uma conexao com poder menor nao alcanca a trilha de
-- auditoria nem o historico de mensagens, mesmo tendo SELECT concedido.
-- Isolamento por corretor exigiria dono por linha e `SET LOCAL`, e nao e o que
-- este sistema faz.

-- --- o papel da aplicacao ---
-- Um papel so, `painel`, dado a quem roda a migracao — que e o usuario com que
-- a aplicacao conecta. Sem esta parte o FORCE abaixo tranca o proprio dono da
-- tabela para fora, porque politica `TO painel` so vale para quem e membro de
-- `painel`. O nome do usuario nao da pra fixar aqui: muda por ambiente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'painel') THEN
    CREATE ROLE painel NOLOGIN;
  END IF;
  EXECUTE format('GRANT painel TO %I', current_user);
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO painel;--> statement-breakpoint
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO painel;--> statement-breakpoint
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO painel;--> statement-breakpoint

-- Tabela criada depois desta migracao ja nasce com o mesmo GRANT. Sem isto, a
-- proxima `drizzle-kit generate` quebraria o painel em producao.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO painel;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO painel;--> statement-breakpoint

-- --- RLS ---
-- FORCE nao e detalhe: sem ele o dono da tabela ignora as politicas, e como a
-- aplicacao roda com o dono, o RLS seria enfeite.
--
-- A politica de leitura e `TO PUBLIC` de proposito, e nao para um papel de
-- nome fixo: quem le so-leitura tem um login proprio em cada ambiente, e RLS
-- nao concede nada — quem nao tiver GRANT de SELECT continua sem ver nada,
-- politica ou nao. O que a politica faz e o contrario: DEIXAR DE existir nas
-- quatro tabelas fechadas, e ai nem o GRANT de SELECT alcanca as linhas.
DO $$
DECLARE
  t text;
  -- As quatro que a conexao so-leitura nao ve. O Agente 5 responde pergunta
  -- com texto vindo de fora — e o mais exposto a injecao e o que menos precisa
  -- da trilha de auditoria e do historico de mensagens.
  fechadas text[] := ARRAY['aprovacao', 'log_evento', 'leitura_modelo', 'mensagem_enviada'];
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY painel_tudo ON public.%I FOR ALL TO painel USING (true) WITH CHECK (true)', t);

    IF NOT (t = ANY(fechadas)) THEN
      EXECUTE format(
        'CREATE POLICY leitura_le ON public.%I FOR SELECT USING (true)', t);
    END IF;
    -- Tabela em `fechadas` fica sem politica de leitura: no RLS, ausencia de
    -- politica e zero linhas, nao erro. E o comportamento certo — o relatorio
    -- simplesmente nao enxerga a trilha, em vez de estourar no meio da
    -- resposta a uma pergunta da equipe.
  END LOOP;
END
$$;
