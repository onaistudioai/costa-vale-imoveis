-- Queda automática do anúncio (PROJECT_SPEC seções 2 e 3).
--
-- "Anúncio cai automaticamente quando estado_comercial sai de disponivel."
-- A spec classifica isso como Regra, não como ação de agente — e é a única
-- solução compatível com a R5: estado_anuncio é do Agente 1, estado_comercial
-- é do Agente 2, e nenhum dos dois pode escrever no campo do outro. Se fosse
-- ação de agente, o CHECK anuncio_exige_pronto_e_disponivel tornaria a
-- transição impossível sem violar a propriedade de dado.
--
-- Escopo deliberado: o trigger mexe só em imovel.estado_anuncio. As linhas da
-- tabela `anuncio` com midia_paga = true continuam intactas até o humano
-- aprovar — é o gate N2 de derrubar mídia. O que cai sozinho é a vitrine, não
-- o gasto.

CREATE OR REPLACE FUNCTION derrubar_anuncio_ao_sair_de_disponivel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado_comercial <> 'disponivel'
     AND OLD.estado_comercial = 'disponivel'
     AND NEW.estado_anuncio = 'no_ar' THEN
    NEW.estado_anuncio := 'pausado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_derrubar_anuncio
  BEFORE UPDATE OF estado_comercial ON imovel
  FOR EACH ROW
  EXECUTE FUNCTION derrubar_anuncio_ao_sair_de_disponivel();
--> statement-breakpoint

-- Anúncio orgânico acompanha a vitrine. Mídia paga não: fica de fora da
-- cláusula WHERE de propósito, esperando decisão humana.
CREATE OR REPLACE FUNCTION pausar_anuncios_organicos()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado_comercial <> 'disponivel' AND OLD.estado_comercial = 'disponivel' THEN
    UPDATE anuncio
       SET status = 'pausado', data_remocao = now()
     WHERE id_imovel = NEW.id_imovel
       AND status = 'no_ar'
       AND midia_paga = false;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_pausar_anuncios_organicos
  AFTER UPDATE OF estado_comercial ON imovel
  FOR EACH ROW
  EXECUTE FUNCTION pausar_anuncios_organicos();
