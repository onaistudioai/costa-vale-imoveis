import type { Laudo } from "@/agentes/curador";
import type { EstadoOperacional } from "@/tipos";

/**
 * O conjunto de referência do Agente 1.
 *
 * Cada caso é um laudo escrito como vendedor escreve, e o estado que a leitura
 * correta produziria. Não guardamos o JSON esperado da extração inteira de
 * propósito: **o que importa é a decisão, não a redação.** Duas extrações
 * diferentes que levam ao mesmo estado são as duas certas; uma extração
 * bonita que libera um imóvel com inventário aberto é um erro caro.
 *
 * `precoEsperado` existe porque preço é o único número que o modelo pode
 * escrever direto no cadastro — e o único campo em que uma alucinação vira
 * anúncio errado no ar.
 *
 * Os três primeiros são os laudos do seed, escritos antes desta aferição
 * existir. Os demais foram escritos pra cobrir as armadilhas que a redação de
 * campo tem e o prompt tenta resolver.
 */

export interface Caso {
  id: string;
  /** O que este caso testa. Aparece no relatório quando ele falha. */
  porque: string;
  laudo: Omit<Laudo, "idLaudo" | "idImovel">;
  esperado: {
    /** Partindo de `em_preparacao`, que é o estado de um imóvel em análise. */
    estado: EstadoOperacional;
    preco: number | null;
  };
}

export const CASOS: Caso[] = [
  {
    id: "seed-certidao",
    porque: "documentação pendente segura o imóvel, mesmo com a casa impecável",
    laudo: {
      textoEstado:
        "Casa em ótimo estado, pintura nova na sala e nos quartos. O piso da área de serviço tem duas trincas pequenas, nada estrutural.",
      textoDocumentacao:
        "Matrícula atualizada saiu na semana passada, IPTU quitado. Certidão negativa da prefeitura ainda não pedi.",
      textoPendencias:
        "Falta só a certidão negativa. O portão eletrônico está com o motor lento, o proprietário disse que vai trocar antes da entrega.",
    },
    esperado: { estado: "com_pendencia", preco: null },
  },
  {
    id: "seed-box",
    porque: "pendência estética com documentação ok não impede anunciar",
    laudo: {
      textoEstado: "Apartamento entregue limpo, sem mobília. Box do banheiro trincado.",
      textoDocumentacao: "Documentação toda ok, conferi com o cartório hoje.",
      textoPendencias:
        "Trocar o box e uma limpeza pesada na cozinha. O síndico disse que a obra da fachada acaba mês que vem, mas isso não afeta a unidade.",
    },
    // Limpeza pesada é obrigatória pelo prompt; o box, não. Com a limpeza
    // aberta, o imóvel fica travado.
    esperado: { estado: "com_pendencia", preco: null },
  },
  {
    id: "seed-inventario",
    porque: "inventário aberto é o bloqueio mais caro de errar",
    laudo: {
      textoEstado:
        "Casa habitada, precisa de reforma no telhado — tem infiltração no quarto dos fundos.",
      textoDocumentacao: "Inventário ainda em andamento, herdeiros não assinaram.",
      textoPendencias: "Telhado e inventário. Não dá pra anunciar antes de resolver os dois.",
    },
    esperado: { estado: "com_pendencia", preco: null },
  },
  {
    id: "so-falta",
    porque: '"só falta" descreve pendência ABERTA, não conclusão',
    laudo: {
      textoEstado: "Tudo pronto, imóvel desocupado e limpo.",
      textoDocumentacao: "Só falta a certidão de ônus reais.",
    },
    esperado: { estado: "com_pendencia", preco: null },
  },
  {
    id: "promessa",
    porque: "promessa do proprietário não é pendência resolvida",
    laudo: {
      textoEstado: "Casa boa, entulho da obra ainda no quintal.",
      textoDocumentacao: "Documentos em ordem.",
      textoPendencias: "O proprietário garantiu que tira o entulho até sexta.",
    },
    esperado: { estado: "com_pendencia", preco: null },
  },
  {
    id: "resolvido-de-verdade",
    porque: "pendência que o laudo afirma concluída libera o imóvel",
    laudo: {
      textoEstado: "Voltei hoje: o entulho foi retirado e a casa está limpa.",
      textoDocumentacao: "Matrícula, IPTU e certidões negativas todas em mãos.",
      textoPendencias: "Nenhuma.",
    },
    esperado: { estado: "pronto", preco: null },
  },
  {
    id: "estetica-aberta",
    porque: "pendência opcional aberta não trava, mas também não é 'pronto'",
    laudo: {
      textoEstado: "Apartamento em bom estado. O rodapé da sala está descolando num canto.",
      textoDocumentacao: "Documentação completa, conferida.",
      textoPendencias: "Só o rodapé, coisa de meia hora de serviço.",
    },
    esperado: { estado: "em_preparacao", preco: null },
  },
  {
    id: "ambiguo",
    porque: "texto vago não pode virar suposição — confiança baixa segura",
    laudo: {
      textoEstado: "Fui lá, tá quase.",
      textoPendencias: "Acho que resolveram aquilo, mas não confirmei.",
    },
    esperado: { estado: "com_pendencia", preco: null },
  },
  {
    id: "preco-declarado",
    porque: "valor declarado pelo proprietário é preço",
    laudo: {
      textoEstado: "Casa pronta, nada a fazer.",
      textoDocumentacao: "Tudo certo, certidões em mãos.",
      textoPendencias: "O proprietário aceitou baixar para R$ 480.000.",
    },
    esperado: { estado: "pronto", preco: 480000 },
  },
  {
    id: "preco-do-vizinho",
    porque: "número que não é o preço DESTE imóvel não pode virar preço",
    laudo: {
      textoEstado: "Sobrado pronto pra anunciar, documentação completa e sem pendência.",
      textoPendencias:
        "O vizinho vendeu o dele por R$ 620.000 no mês passado, serve de referência.",
    },
    esperado: { estado: "pronto", preco: null },
  },
];
