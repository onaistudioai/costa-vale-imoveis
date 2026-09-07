CREATE TYPE "public"."agente_origem" AS ENUM('1_curador', '2_guardiao', '3_roteador', '4_atendimento', 'humano', 'regra');--> statement-breakpoint
CREATE TYPE "public"."estado_anuncio" AS ENUM('sem_anuncio', 'no_ar', 'pausado', 'removido');--> statement-breakpoint
CREATE TYPE "public"."estado_aprovacao" AS ENUM('pendente', 'aprovado', 'negado');--> statement-breakpoint
CREATE TYPE "public"."estado_comercial" AS ENUM('disponivel', 'em_negociacao', 'em_processo_venda', 'fechado', 'arquivado');--> statement-breakpoint
CREATE TYPE "public"."estado_operacional" AS ENUM('captado', 'em_preparacao', 'pronto', 'com_pendencia', 'reprovado');--> statement-breakpoint
CREATE TYPE "public"."nivel_dominio" AS ENUM('captou', 'ja_visitou', 'conhece_regiao');--> statement-breakpoint
CREATE TYPE "public"."papel_cliente" AS ENUM('proprietario', 'comprador', 'inquilino', 'lead');--> statement-breakpoint
CREATE TYPE "public"."tipo_aprovacao" AS ENUM('subir_anuncio', 'derrubar_midia', 'liberar_reprovado', 'escalacao_n3');--> statement-breakpoint
CREATE TABLE "agenda" (
	"id_evento" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_corretor" uuid NOT NULL,
	"id_imovel" uuid,
	"id_cliente" uuid,
	"inicio" timestamp NOT NULL,
	"fim" timestamp NOT NULL,
	"status" varchar(30) DEFAULT 'reservado' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anuncio" (
	"id_anuncio" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_imovel" uuid NOT NULL,
	"canal" varchar(50) NOT NULL,
	"status" "estado_anuncio" DEFAULT 'no_ar' NOT NULL,
	"midia_paga" boolean DEFAULT false NOT NULL,
	"data_publicacao" timestamp DEFAULT now() NOT NULL,
	"data_remocao" timestamp,
	"custo_acumulado" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aprovacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_aprovacao" NOT NULL,
	"entidade" varchar(50) NOT NULL,
	"id_entidade" uuid NOT NULL,
	"solicitado_por_agente" "agente_origem" NOT NULL,
	"estado" "estado_aprovacao" DEFAULT 'pendente' NOT NULL,
	"contexto" jsonb,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"decidido_por" varchar(255),
	"decidido_em" timestamp,
	"motivo" text
);
--> statement-breakpoint
CREATE TABLE "busca" (
	"id_busca" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_cliente" uuid NOT NULL,
	"valor_min" numeric(14, 2),
	"valor_max" numeric(14, 2),
	"tipo_imovel" varchar(50),
	"bairros_desejados" text[],
	"texto_original" text NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cliente" (
	"id_cliente" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" varchar(255) NOT NULL,
	"cpf_cnpj" varchar(20),
	"telefone" varchar(30),
	"email" varchar(255),
	"origem_canal" varchar(50),
	"data_entrada" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corretor" (
	"id_corretor" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" varchar(255) NOT NULL,
	"telefone" varchar(30),
	"comissao_percentual" numeric(5, 2),
	"regioes_atuacao" text[],
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dominio_corretor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_corretor" uuid NOT NULL,
	"id_imovel" uuid NOT NULL,
	"nivel" "nivel_dominio" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evento_processado" (
	"id_evento" uuid PRIMARY KEY NOT NULL,
	"tipo" varchar(60) NOT NULL,
	"agente" "agente_origem" NOT NULL,
	"processado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imovel" (
	"id_imovel" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" varchar(50) NOT NULL,
	"preco" numeric(14, 2),
	"endereco" text NOT NULL,
	"bairro" varchar(120),
	"cidade" varchar(120) NOT NULL,
	"pontos_referencia" text,
	"id_proprietario" uuid,
	"id_corretor_captador" uuid,
	"estado_operacional" "estado_operacional" DEFAULT 'captado' NOT NULL,
	"estado_comercial" "estado_comercial" DEFAULT 'disponivel' NOT NULL,
	"estado_anuncio" "estado_anuncio" DEFAULT 'sem_anuncio' NOT NULL,
	"data_captacao" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "anuncio_exige_pronto_e_disponivel" CHECK ("imovel"."estado_anuncio" <> 'no_ar' OR ("imovel"."estado_operacional" = 'pronto' AND "imovel"."estado_comercial" = 'disponivel'))
);
--> statement-breakpoint
CREATE TABLE "laudo" (
	"id_laudo" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_imovel" uuid NOT NULL,
	"id_autor" uuid,
	"tipo" varchar(50) NOT NULL,
	"texto_estado" text,
	"texto_documentacao" text,
	"texto_pendencias" text,
	"extracao_estruturada" jsonb,
	"data" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agente_origem" "agente_origem" NOT NULL,
	"entidade" varchar(50) NOT NULL,
	"id_entidade" uuid NOT NULL,
	"campo" varchar(80) NOT NULL,
	"valor_anterior" text,
	"valor_novo" text,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"aprovado_por" varchar(255),
	"id_evento" uuid
);
--> statement-breakpoint
CREATE TABLE "papel" (
	"id_papel" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_cliente" uuid NOT NULL,
	"id_imovel" uuid,
	"papel" "papel_cliente" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transacao" (
	"id_transacao" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_imovel" uuid NOT NULL,
	"id_cliente_comprador" uuid,
	"id_corretor" uuid,
	"tipo" varchar(30) NOT NULL,
	"valor_final" numeric(14, 2),
	"data_fechamento" timestamp,
	"comissao_paga" boolean DEFAULT false NOT NULL,
	"etapa" varchar(50) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vinculo_lead_corretor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_cliente" uuid NOT NULL,
	"id_corretor" uuid NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"ultima_interacao" timestamp DEFAULT now() NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agenda" ADD CONSTRAINT "agenda_id_corretor_corretor_id_corretor_fk" FOREIGN KEY ("id_corretor") REFERENCES "public"."corretor"("id_corretor") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda" ADD CONSTRAINT "agenda_id_imovel_imovel_id_imovel_fk" FOREIGN KEY ("id_imovel") REFERENCES "public"."imovel"("id_imovel") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda" ADD CONSTRAINT "agenda_id_cliente_cliente_id_cliente_fk" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anuncio" ADD CONSTRAINT "anuncio_id_imovel_imovel_id_imovel_fk" FOREIGN KEY ("id_imovel") REFERENCES "public"."imovel"("id_imovel") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busca" ADD CONSTRAINT "busca_id_cliente_cliente_id_cliente_fk" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dominio_corretor" ADD CONSTRAINT "dominio_corretor_id_corretor_corretor_id_corretor_fk" FOREIGN KEY ("id_corretor") REFERENCES "public"."corretor"("id_corretor") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dominio_corretor" ADD CONSTRAINT "dominio_corretor_id_imovel_imovel_id_imovel_fk" FOREIGN KEY ("id_imovel") REFERENCES "public"."imovel"("id_imovel") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imovel" ADD CONSTRAINT "imovel_id_proprietario_cliente_id_cliente_fk" FOREIGN KEY ("id_proprietario") REFERENCES "public"."cliente"("id_cliente") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imovel" ADD CONSTRAINT "imovel_id_corretor_captador_corretor_id_corretor_fk" FOREIGN KEY ("id_corretor_captador") REFERENCES "public"."corretor"("id_corretor") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laudo" ADD CONSTRAINT "laudo_id_imovel_imovel_id_imovel_fk" FOREIGN KEY ("id_imovel") REFERENCES "public"."imovel"("id_imovel") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papel" ADD CONSTRAINT "papel_id_cliente_cliente_id_cliente_fk" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papel" ADD CONSTRAINT "papel_id_imovel_imovel_id_imovel_fk" FOREIGN KEY ("id_imovel") REFERENCES "public"."imovel"("id_imovel") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacao" ADD CONSTRAINT "transacao_id_imovel_imovel_id_imovel_fk" FOREIGN KEY ("id_imovel") REFERENCES "public"."imovel"("id_imovel") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacao" ADD CONSTRAINT "transacao_id_cliente_comprador_cliente_id_cliente_fk" FOREIGN KEY ("id_cliente_comprador") REFERENCES "public"."cliente"("id_cliente") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacao" ADD CONSTRAINT "transacao_id_corretor_corretor_id_corretor_fk" FOREIGN KEY ("id_corretor") REFERENCES "public"."corretor"("id_corretor") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_lead_corretor" ADD CONSTRAINT "vinculo_lead_corretor_id_cliente_cliente_id_cliente_fk" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_lead_corretor" ADD CONSTRAINT "vinculo_lead_corretor_id_corretor_corretor_id_corretor_fk" FOREIGN KEY ("id_corretor") REFERENCES "public"."corretor"("id_corretor") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agenda_corretor_idx" ON "agenda" USING btree ("id_corretor","inicio");--> statement-breakpoint
CREATE INDEX "anuncio_imovel_idx" ON "anuncio" USING btree ("id_imovel","status");--> statement-breakpoint
CREATE INDEX "aprovacao_pendente_idx" ON "aprovacao" USING btree ("estado","criado_em");--> statement-breakpoint
CREATE INDEX "busca_cliente_idx" ON "busca" USING btree ("id_cliente");--> statement-breakpoint
CREATE UNIQUE INDEX "dominio_corretor_par_idx" ON "dominio_corretor" USING btree ("id_corretor","id_imovel");--> statement-breakpoint
CREATE INDEX "dominio_imovel_idx" ON "dominio_corretor" USING btree ("id_imovel");--> statement-breakpoint
CREATE INDEX "imovel_estados_idx" ON "imovel" USING btree ("estado_operacional","estado_comercial","estado_anuncio");--> statement-breakpoint
CREATE INDEX "laudo_imovel_idx" ON "laudo" USING btree ("id_imovel","data");--> statement-breakpoint
CREATE INDEX "log_entidade_idx" ON "log_evento" USING btree ("entidade","id_entidade","timestamp");--> statement-breakpoint
CREATE INDEX "papel_cliente_idx" ON "papel" USING btree ("id_cliente","ativo");--> statement-breakpoint
CREATE INDEX "transacao_imovel_idx" ON "transacao" USING btree ("id_imovel");--> statement-breakpoint
CREATE INDEX "vinculo_cliente_idx" ON "vinculo_lead_corretor" USING btree ("id_cliente","ativo");