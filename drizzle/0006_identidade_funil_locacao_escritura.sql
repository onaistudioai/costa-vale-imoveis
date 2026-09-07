CREATE TYPE "public"."canal_identidade" AS ENUM('whatsapp', 'instagram', 'facebook', 'site', 'email', 'telefone', 'portal');--> statement-breakpoint
CREATE TYPE "public"."estado_atendimento" AS ENUM('aberto', 'pendente', 'fechado');--> statement-breakpoint
CREATE TYPE "public"."estado_contrato_locacao" AS ENUM('ativo', 'em_rescisao', 'encerrado');--> statement-breakpoint
CREATE TYPE "public"."estado_parcela" AS ENUM('aberta', 'paga', 'atrasada', 'repassada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."etapa_atendimento" AS ENUM('primeiro_contato', 'qualificado', 'visita_agendada', 'visita_feita', 'proposta', 'negociacao', 'ganho', 'perdido');--> statement-breakpoint
CREATE TYPE "public"."etapa_escritura" AS ENUM('contrato_assinado', 'documentacao', 'itbi_emitido', 'itbi_pago', 'escritura_lavrada', 'registro_protocolado', 'registro_concluido', 'concluido', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."indice_reajuste" AS ENUM('igpm', 'ipca', 'inpc');--> statement-breakpoint
CREATE TYPE "public"."origem_vinculo_identidade" AS ENUM('deterministica', 'declarada', 'humana', 'probabilistica');--> statement-breakpoint
CREATE TYPE "public"."responsavel_etapa" AS ENUM('imobiliaria', 'comprador', 'vendedor', 'cartorio', 'prefeitura', 'banco');--> statement-breakpoint
ALTER TYPE "public"."agente_origem" ADD VALUE '6_alterador' BEFORE 'humano';--> statement-breakpoint
ALTER TYPE "public"."tipo_aprovacao" ADD VALUE 'fundir_identidade';--> statement-breakpoint
ALTER TYPE "public"."tipo_aprovacao" ADD VALUE 'aplicar_alteracao';--> statement-breakpoint
ALTER TYPE "public"."tipo_aprovacao" ADD VALUE 'reajuste_aluguel';--> statement-breakpoint
CREATE TABLE "atendimento" (
	"id_atendimento" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_cliente" uuid NOT NULL,
	"id_imovel" uuid,
	"id_corretor" uuid,
	"etapa" "etapa_atendimento" DEFAULT 'primeiro_contato' NOT NULL,
	"estado" "estado_atendimento" DEFAULT 'aberto' NOT NULL,
	"etapa_maxima" "etapa_atendimento" DEFAULT 'primeiro_contato' NOT NULL,
	"motivo_desfecho" text,
	"ultima_interacao" timestamp DEFAULT now() NOT NULL,
	"ultimo_contato_por" varchar(20) DEFAULT 'cliente' NOT NULL,
	"prioridade" integer DEFAULT 0 NOT NULL,
	"precisa_desfecho" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contrato_locacao" (
	"id_contrato" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_imovel" uuid NOT NULL,
	"id_inquilino" uuid NOT NULL,
	"id_proprietario" uuid NOT NULL,
	"valor_aluguel" numeric(12, 2) NOT NULL,
	"valor_condominio" numeric(12, 2) DEFAULT '0' NOT NULL,
	"valor_iptu" numeric(12, 2) DEFAULT '0' NOT NULL,
	"dia_vencimento" integer DEFAULT 10 NOT NULL,
	"inicio" timestamp NOT NULL,
	"fim" timestamp NOT NULL,
	"indice" "indice_reajuste" DEFAULT 'igpm' NOT NULL,
	"ultimo_reajuste" timestamp,
	"taxa_administracao" numeric(5, 2) DEFAULT '10' NOT NULL,
	"multa_atraso" numeric(5, 2) DEFAULT '2' NOT NULL,
	"juros_mes" numeric(5, 2) DEFAULT '1' NOT NULL,
	"estado" "estado_contrato_locacao" DEFAULT 'ativo' NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_cliente" uuid NOT NULL,
	"canal" "canal_identidade" NOT NULL,
	"identificador" varchar(255) NOT NULL,
	"apelido" varchar(255),
	"origem" "origem_vinculo_identidade" DEFAULT 'deterministica' NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parcela_aluguel" (
	"id_parcela" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_contrato" uuid NOT NULL,
	"competencia" varchar(7) NOT NULL,
	"vencimento" timestamp NOT NULL,
	"valor_base" numeric(12, 2) NOT NULL,
	"valor_encargos" numeric(12, 2) DEFAULT '0' NOT NULL,
	"valor_pago" numeric(12, 2),
	"pago_em" timestamp,
	"repassado_em" timestamp,
	"estado" "estado_parcela" DEFAULT 'aberta' NOT NULL,
	"estagio_cobranca" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processo_escritura" (
	"id_processo" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_imovel" uuid NOT NULL,
	"id_transacao" uuid,
	"id_comprador" uuid,
	"id_vendedor" uuid,
	"etapa" "etapa_escritura" DEFAULT 'contrato_assinado' NOT NULL,
	"etapa_desde" timestamp DEFAULT now() NOT NULL,
	"cartorio_notas" varchar(255),
	"cartorio_registro" varchar(255),
	"matricula" varchar(80),
	"valor_itbi" numeric(12, 2),
	"documentos_entregues" text[],
	"alertado_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"concluido_em" timestamp
);
--> statement-breakpoint
ALTER TABLE "atendimento" ADD CONSTRAINT "atendimento_id_cliente_cliente_id_cliente_fk" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atendimento" ADD CONSTRAINT "atendimento_id_imovel_imovel_id_imovel_fk" FOREIGN KEY ("id_imovel") REFERENCES "public"."imovel"("id_imovel") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atendimento" ADD CONSTRAINT "atendimento_id_corretor_corretor_id_corretor_fk" FOREIGN KEY ("id_corretor") REFERENCES "public"."corretor"("id_corretor") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato_locacao" ADD CONSTRAINT "contrato_locacao_id_imovel_imovel_id_imovel_fk" FOREIGN KEY ("id_imovel") REFERENCES "public"."imovel"("id_imovel") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato_locacao" ADD CONSTRAINT "contrato_locacao_id_inquilino_cliente_id_cliente_fk" FOREIGN KEY ("id_inquilino") REFERENCES "public"."cliente"("id_cliente") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato_locacao" ADD CONSTRAINT "contrato_locacao_id_proprietario_cliente_id_cliente_fk" FOREIGN KEY ("id_proprietario") REFERENCES "public"."cliente"("id_cliente") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identidade" ADD CONSTRAINT "identidade_id_cliente_cliente_id_cliente_fk" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcela_aluguel" ADD CONSTRAINT "parcela_aluguel_id_contrato_contrato_locacao_id_contrato_fk" FOREIGN KEY ("id_contrato") REFERENCES "public"."contrato_locacao"("id_contrato") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processo_escritura" ADD CONSTRAINT "processo_escritura_id_imovel_imovel_id_imovel_fk" FOREIGN KEY ("id_imovel") REFERENCES "public"."imovel"("id_imovel") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processo_escritura" ADD CONSTRAINT "processo_escritura_id_transacao_transacao_id_transacao_fk" FOREIGN KEY ("id_transacao") REFERENCES "public"."transacao"("id_transacao") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processo_escritura" ADD CONSTRAINT "processo_escritura_id_comprador_cliente_id_cliente_fk" FOREIGN KEY ("id_comprador") REFERENCES "public"."cliente"("id_cliente") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processo_escritura" ADD CONSTRAINT "processo_escritura_id_vendedor_cliente_id_cliente_fk" FOREIGN KEY ("id_vendedor") REFERENCES "public"."cliente"("id_cliente") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "atendimento_fila_idx" ON "atendimento" USING btree ("estado","prioridade");--> statement-breakpoint
CREATE INDEX "atendimento_cliente_idx" ON "atendimento" USING btree ("id_cliente","estado");--> statement-breakpoint
CREATE UNIQUE INDEX "atendimento_par_idx" ON "atendimento" USING btree ("id_cliente","id_imovel");--> statement-breakpoint
CREATE INDEX "contrato_estado_idx" ON "contrato_locacao" USING btree ("estado","fim");--> statement-breakpoint
CREATE INDEX "contrato_imovel_idx" ON "contrato_locacao" USING btree ("id_imovel");--> statement-breakpoint
CREATE UNIQUE INDEX "identidade_canal_idx" ON "identidade" USING btree ("canal","identificador");--> statement-breakpoint
CREATE INDEX "identidade_cliente_idx" ON "identidade" USING btree ("id_cliente");--> statement-breakpoint
CREATE INDEX "parcela_vencimento_idx" ON "parcela_aluguel" USING btree ("estado","vencimento");--> statement-breakpoint
CREATE UNIQUE INDEX "parcela_competencia_idx" ON "parcela_aluguel" USING btree ("id_contrato","competencia");--> statement-breakpoint
CREATE INDEX "escritura_etapa_idx" ON "processo_escritura" USING btree ("etapa","etapa_desde");--> statement-breakpoint
CREATE INDEX "escritura_imovel_idx" ON "processo_escritura" USING btree ("id_imovel");