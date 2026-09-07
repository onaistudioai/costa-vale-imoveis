import { db, pool, schema } from "../src/lib/db";

/**
 * Estoque fictício de Sorocaba/SP para calibrar o sistema com dado plausível.
 *
 * Os bairros e a ordem de valorização são reais (Campolim é o metro quadrado
 * mais caro da cidade, ~R$ 9,2 mil/m²; Mangal e Jardim América vêm logo
 * abaixo; Wanel Ville e Éden são a ponta popular). **Pessoas, endereços,
 * telefones e valores exatos são inventados** — nada aqui corresponde a imóvel
 * ou corretor real.
 *
 * Existe por dois motivos concretos:
 *  1. `dominio_corretor` vazia faz o Agente 3 pontuar degradado e escalar tudo;
 *  2. `score_minimo` (hoje 40, chute) só dá pra calibrar com estoque.
 *
 * Rodar: npm run seed
 */

const M2 = {
  Campolim: 9200,
  Mangal: 6600,
  "Jardim América": 6100,
  "Santa Rosália": 5200,
  "Jardim Piazza di Roma": 5600,
  Centro: 4900,
  "Vila Hortência": 4400,
  "Wanel Ville": 3400,
  Éden: 3100,
} as const;

type Bairro = keyof typeof M2;

/** Preço = m² do bairro × área, arredondado pra milhar. É como o mercado anuncia. */
const preco = (bairro: Bairro, area: number) =>
  String(Math.round((M2[bairro] * area) / 1000) * 1000);

const CORRETORES = [
  { nome: "Ana Beatriz Moraes", telefone: "15991000001", comissao: "5.00", regioes: ["Campolim", "Mangal", "Jardim América"] },
  { nome: "Bruno Tavares Lima", telefone: "15991000002", comissao: "5.00", regioes: ["Centro", "Santa Rosália", "Vila Hortência"] },
  { nome: "Carla Nunes Ferrari", telefone: "15991000003", comissao: "4.50", regioes: ["Campolim", "Jardim Piazza di Roma"] },
  { nome: "Diego Ramalho Pinto", telefone: "15991000004", comissao: "4.50", regioes: ["Wanel Ville", "Éden", "Vila Hortência"] },
  { nome: "Elaine Barros Cruz", telefone: "15991000005", comissao: "5.50", regioes: ["Mangal", "Jardim América", "Centro"] },
  // Inativa de propósito: o roteamento tem que ignorar quem não está na ativa.
  { nome: "Fábio Otero Simas", telefone: "15991000006", comissao: "4.00", regioes: ["Centro"], ativo: false },
];

const IMOVEIS: {
  tipo: string;
  bairro: Bairro;
  area: number;
  endereco: string;
  referencia: string;
  estadoOperacional?: "captado" | "em_preparacao" | "pronto" | "com_pendencia" | "reprovado";
  estadoAnuncio?: "sem_anuncio" | "no_ar" | "pausado" | "removido";
}[] = [
  { tipo: "apartamento", bairro: "Campolim", area: 92, endereco: "Av. Gisele Constantino, 780 — apto 141", referencia: "em frente ao Shopping Iguatemi", estadoOperacional: "pronto", estadoAnuncio: "no_ar" },
  { tipo: "apartamento", bairro: "Campolim", area: 128, endereco: "Rua Antônio Carlos Comitre, 210 — apto 92", referencia: "ao lado do Parque Campolim", estadoOperacional: "pronto", estadoAnuncio: "no_ar" },
  { tipo: "casa", bairro: "Mangal", area: 180, endereco: "Rua José Bonifácio Filho, 45", referencia: "duas quadras do Parque Zoológico", estadoOperacional: "pronto", estadoAnuncio: "no_ar" },
  { tipo: "casa", bairro: "Jardim América", area: 210, endereco: "Rua Rui Barbosa, 1122", referencia: "esquina com a Av. Ipanema", estadoOperacional: "em_preparacao" },
  { tipo: "apartamento", bairro: "Jardim Piazza di Roma", area: 74, endereco: "Rua Verona, 300 — apto 44", referencia: "condomínio com portaria 24h", estadoOperacional: "em_preparacao" },
  { tipo: "casa", bairro: "Santa Rosália", area: 145, endereco: "Rua dos Andradas, 517", referencia: "perto do Hospital Santa Lucinda", estadoOperacional: "com_pendencia" },
  { tipo: "apartamento", bairro: "Centro", area: 68, endereco: "Rua São Bento, 88 — apto 71", referencia: "a 200 m da Catedral", estadoOperacional: "captado" },
  { tipo: "casa", bairro: "Vila Hortência", area: 132, endereco: "Rua Padre Luiz, 640", referencia: "rua sem saída, área tranquila", estadoOperacional: "pronto", estadoAnuncio: "no_ar" },
  { tipo: "casa", bairro: "Wanel Ville", area: 98, endereco: "Rua Wanel Ville IV, 219", referencia: "próximo ao terminal Vitória Régia", estadoOperacional: "captado" },
  { tipo: "terreno", bairro: "Éden", area: 250, endereco: "Rua Guaicurus, s/n — lote 14", referencia: "quadra já urbanizada", estadoOperacional: "reprovado" },
];

const CLIENTES = [
  { nome: "Helena Prado Vasques", telefone: "15992000001", email: "helena.prado@exemplo.com.br", origemCanal: "whatsapp" },
  { nome: "Igor Sampaio Rocha", telefone: "15992000002", email: "igor.rocha@exemplo.com.br", origemCanal: "site" },
  { nome: "Juliana Mesquita Alves", telefone: "15992000003", email: "juliana.alves@exemplo.com.br", origemCanal: "portal" },
  { nome: "Kleber Antunes Dias", telefone: "15992000004", email: "kleber.dias@exemplo.com.br", origemCanal: "indicacao" },
  // Os dois cadastros abaixo são a MESMA pessoa, e é de propósito. Ela chegou
  // primeiro por DM no Instagram (sem telefone nenhum) e depois pelo WhatsApp
  // com o perfil escrito "Ju 💛". Nenhum campo idêntico liga os dois: nem
  // telefone, nem nome, nem e-mail. O que liga é o apelido — `ju.mendes.sp`
  // no Insta e `jumendes` no cadastro do site.
  { nome: "ju.mendes.sp", telefone: null, email: null, origemCanal: "instagram" },
  { nome: "Ju", telefone: "15993110022", email: null, origemCanal: "whatsapp" },
  { nome: "Marcos Ferreira Lopes", telefone: "15992000005", email: "marcos.lopes@exemplo.com.br", origemCanal: "site" },
  { nome: "Natália Ribeiro Campos", telefone: "15992000006", email: "natalia.campos@exemplo.com.br", origemCanal: "whatsapp" },
];

async function limpar() {
  // Ordem inversa das dependências. `evento_processado` e `aprovacao` entram
  // porque um seed com fila velha faz o painel mentir.
  for (const t of [
    schema.logEvento,
    schema.aprovacao,
    schema.eventoProcessado,
    schema.parcelaAluguel,
    schema.contratoLocacao,
    schema.processoEscritura,
    schema.atendimento,
    schema.identidade,
    schema.agenda,
    schema.vinculoLeadCorretor,
    schema.dominioCorretor,
    schema.busca,
    schema.papel,
    schema.anuncio,
    schema.laudo,
    schema.transacao,
    schema.imovel,
    schema.cliente,
    schema.corretor,
  ]) {
    await db.delete(t);
  }
}

async function main() {
  await limpar();

  const corretores = await db
    .insert(schema.corretor)
    .values(
      CORRETORES.map((c) => ({
        nome: c.nome,
        telefone: c.telefone,
        comissaoPercentual: c.comissao,
        regioesAtuacao: c.regioes,
        ativo: c.ativo ?? true,
      })),
    )
    .returning();

  const clientes = await db.insert(schema.cliente).values(CLIENTES).returning();

  const imoveis = await db
    .insert(schema.imovel)
    .values(
      IMOVEIS.map((i, n) => ({
        tipo: i.tipo,
        preco: preco(i.bairro, i.area),
        endereco: i.endereco,
        bairro: i.bairro,
        cidade: "Sorocaba",
        pontosReferencia: i.referencia,
        // O proprietário circula entre os clientes: a mesma pessoa pode ser
        // proprietária de um imóvel e compradora de outro (seção 6).
        idProprietario: clientes[n % clientes.length]!.idCliente,
        idCorretorCaptador: corretores[n % 5]!.idCorretor,
        estadoOperacional: i.estadoOperacional ?? "captado",
        estadoAnuncio: i.estadoAnuncio ?? "sem_anuncio",
      })),
    )
    .returning();

  // --- dominio_corretor: a tabela que o Agente 3 usa pra pontuar ---
  //
  // Três níveis, e a diferença entre eles é o que o peso traduz:
  //  captou (100)          — trouxe o imóvel, conhece o proprietário
  //  ja_visitou (60)       — levou cliente lá dentro, sabe o que a foto esconde
  //  conhece_regiao (25)   — atua no bairro, mas nunca entrou neste imóvel
  //
  // De propósito: dois imóveis (Wanel Ville e o terreno do Éden) ficam SEM
  // ninguém com domínio. É o caso que faz o envelope do `score_minimo` disparar
  // e a escalação aparecer no painel — o cenário que precisa ser calibrado.
  const dominios: (typeof schema.dominioCorretor.$inferInsert)[] = [];
  const dominio = (n: number, c: number, nivel: "captou" | "ja_visitou" | "conhece_regiao") =>
    dominios.push({
      idImovel: imoveis[n]!.idImovel,
      idCorretor: corretores[c]!.idCorretor,
      nivel,
    });

  dominio(0, 0, "captou");          // Ana captou o apto do Campolim
  dominio(0, 2, "conhece_regiao");  // Carla atua no Campolim
  dominio(1, 2, "captou");          // Carla captou o apto grande do Campolim
  dominio(1, 0, "ja_visitou");      // Ana já levou cliente lá
  dominio(2, 4, "captou");          // Elaine captou a casa do Mangal
  dominio(2, 0, "conhece_regiao");
  dominio(3, 0, "captou");          // Ana captou a casa do Jardim América
  dominio(3, 4, "ja_visitou");
  dominio(4, 2, "captou");          // Carla, Piazza di Roma
  dominio(5, 1, "captou");          // Bruno, Santa Rosália
  dominio(5, 3, "conhece_regiao");
  dominio(6, 1, "captou");          // Bruno, Centro
  dominio(6, 4, "conhece_regiao");
  dominio(7, 3, "ja_visitou");      // Diego já visitou a casa da Vila Hortência
  dominio(7, 1, "conhece_regiao");

  await db.insert(schema.dominioCorretor).values(dominios);

  // Anúncios dos imóveis que já estão no ar. A mídia paga é o que faz o gate
  // `derrubar_midia` ter custo em risco pra mostrar.
  await db.insert(schema.anuncio).values([
    { idImovel: imoveis[0]!.idImovel, canal: "site" },
    { idImovel: imoveis[0]!.idImovel, canal: "portal" },
    { idImovel: imoveis[0]!.idImovel, canal: "meta", midiaPaga: true, custoAcumulado: "412.90" },
    { idImovel: imoveis[1]!.idImovel, canal: "site" },
    { idImovel: imoveis[1]!.idImovel, canal: "portal" },
    { idImovel: imoveis[2]!.idImovel, canal: "site" },
    { idImovel: imoveis[2]!.idImovel, canal: "meta", midiaPaga: true, custoAcumulado: "188.40" },
    { idImovel: imoveis[7]!.idImovel, canal: "site" },
  ]);

  // Laudos em texto de vendedor de campo — é o que o Agente 1 tem que ler.
  await db.insert(schema.laudo).values([
    {
      idImovel: imoveis[3]!.idImovel,
      tipo: "vistoria",
      textoEstado: "Casa em ótimo estado, pintura nova na sala e nos quartos. O piso da área de serviço tem duas trincas pequenas, nada estrutural.",
      textoDocumentacao: "Matrícula atualizada saiu na semana passada, IPTU quitado. Certidão negativa da prefeitura ainda não pedi.",
      textoPendencias: "Falta só a certidão negativa. O portão eletrônico está com o motor lento, o proprietário disse que vai trocar antes da entrega.",
    },
    {
      idImovel: imoveis[4]!.idImovel,
      tipo: "vistoria",
      textoEstado: "Apartamento entregue limpo, sem mobília. Box do banheiro trincado.",
      textoDocumentacao: "Documentação toda ok, conferi com o cartório hoje.",
      textoPendencias: "Trocar o box e uma limpeza pesada na cozinha. O síndico disse que a obra da fachada acaba mês que vem, mas isso não afeta a unidade.",
    },
    {
      idImovel: imoveis[5]!.idImovel,
      tipo: "vistoria",
      textoEstado: "Casa habitada, precisa de reforma no telhado — tem infiltração no quarto dos fundos.",
      textoDocumentacao: "Inventário ainda em andamento, herdeiros não assinaram.",
      textoPendencias: "Telhado e inventário. Não dá pra anunciar antes de resolver os dois.",
    },
  ]);

  // Papéis: quem é proprietário de quê. Sem `tipo` no cliente, de propósito.
  await db.insert(schema.papel).values(
    imoveis.map((im, n) => ({
      idCliente: clientes[n % clientes.length]!.idCliente,
      idImovel: im.idImovel,
      papel: "proprietario" as const,
    })),
  );


  // --- Wave 8: identidade, funil, locação e escrituras ---

  // A mesma pessoa nos dois cadastros duplicados. Repare que NÃO existe um
  // campo em comum entre eles: é exatamente o caso que o telefone não resolve.
  await db.insert(schema.identidade).values([
    { idCliente: clientes[4]!.idCliente, canal: "instagram", identificador: "ju.mendes.sp", apelido: "Ju Mendes | Sorocaba" },
    { idCliente: clientes[5]!.idCliente, canal: "whatsapp", identificador: "5515993110022", apelido: "Ju" },
    { idCliente: clientes[0]!.idCliente, canal: "whatsapp", identificador: "5515992000001", apelido: "Helena Prado" },
    { idCliente: clientes[1]!.idCliente, canal: "site", identificador: "igor.rocha@exemplo.com.br", apelido: "Igor Rocha" },
    { idCliente: clientes[2]!.idCliente, canal: "portal", identificador: "vivareal:8827311", apelido: "Juliana M. Alves" },
  ]);

  // As duas buscas parecidas são o segundo indício que liga os cadastros
  // duplicados: mesma região, mesmo tipo, faixa que se sobrepõe.
  await db.insert(schema.busca).values([
    {
      idCliente: clientes[4]!.idCliente,
      tipoImovel: "apartamento",
      bairrosDesejados: ["Campolim"],
      valorMin: "700000",
      valorMax: "900000",
      textoOriginal: "oi! vi o ape de voces no insta, tem algo no Campolim ate uns 900?",
    },
    {
      idCliente: clientes[5]!.idCliente,
      tipoImovel: "apartamento",
      bairrosDesejados: ["Campolim", "Parque Campolim"],
      valorMin: "750000",
      valorMax: "950000",
      textoOriginal: "boa noite, procuro apartamento 3 dorm no campolim, ate 950",
    },
  ]);

  // O funil, montado pra mostrar a inversão que a lista por data esconde: o
  // caso de proposta parado há 8 dias tem que aparecer ACIMA do primeiro
  // contato de ontem.
  const agora = new Date();
  const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000);

  await db.insert(schema.atendimento).values([
    {
      idCliente: clientes[0]!.idCliente,
      idImovel: imoveis[0]!.idImovel,
      idCorretor: corretores[0]!.idCorretor,
      etapa: "proposta",
      etapaMaxima: "proposta",
      estado: "pendente",
      ultimaInteracao: diasAtras(8),
      ultimoContatoPor: "nos",
    },
    {
      idCliente: clientes[1]!.idCliente,
      idImovel: imoveis[1]!.idImovel,
      idCorretor: corretores[1]!.idCorretor,
      etapa: "visita_feita",
      etapaMaxima: "visita_feita",
      estado: "pendente",
      ultimaInteracao: diasAtras(3),
      ultimoContatoPor: "nos",
    },
    {
      // Cliente falou por último: a bola é nossa, e isso ganha de tudo.
      idCliente: clientes[2]!.idCliente,
      idImovel: imoveis[2]!.idImovel,
      idCorretor: corretores[2]!.idCorretor,
      etapa: "qualificado",
      etapaMaxima: "qualificado",
      estado: "aberto",
      ultimaInteracao: diasAtras(1),
      ultimoContatoPor: "cliente",
    },
    {
      // Chegou em negociação e sumiu há 20 dias. É o caso que a lista de
      // "não responderam" ordenada por data enterraria no fim.
      idCliente: clientes[3]!.idCliente,
      idImovel: imoveis[3]!.idImovel,
      idCorretor: corretores[0]!.idCorretor,
      etapa: "negociacao",
      etapaMaxima: "negociacao",
      estado: "pendente",
      ultimaInteracao: diasAtras(20),
      ultimoContatoPor: "nos",
    },
    {
      idCliente: clientes[6]!.idCliente,
      idImovel: imoveis[4]!.idImovel,
      etapa: "primeiro_contato",
      etapaMaxima: "primeiro_contato",
      estado: "pendente",
      ultimaInteracao: diasAtras(2),
      ultimoContatoPor: "nos",
    },
    {
      // Já encerrado com motivo: é o que faz "quantos perdemos por preço?"
      // ter resposta.
      idCliente: clientes[7]!.idCliente,
      idImovel: imoveis[5]!.idImovel,
      etapa: "perdido",
      etapaMaxima: "visita_feita",
      estado: "fechado",
      motivoDesfecho: "preco_acima_do_orcamento",
      ultimaInteracao: diasAtras(45),
      ultimoContatoPor: "cliente",
    },
  ]);

  // Dois contratos de locação: um em dia, um com o inquilino atrasado.
  const locacoes = await db
    .insert(schema.contratoLocacao)
    .values([
      {
        idImovel: imoveis[6]!.idImovel,
        idInquilino: clientes[6]!.idCliente,
        idProprietario: clientes[0]!.idCliente,
        valorAluguel: "2800",
        valorCondominio: "520",
        valorIptu: "140",
        diaVencimento: 10,
        // Começou há mais de um ano: o aniversário de reajuste já venceu.
        inicio: new Date(agora.getFullYear() - 1, 2, 15),
        fim: new Date(agora.getFullYear() + 1, 2, 14),
        indice: "igpm",
        taxaAdministracao: "10",
      },
      {
        idImovel: imoveis[7]!.idImovel,
        idInquilino: clientes[7]!.idCliente,
        idProprietario: clientes[1]!.idCliente,
        valorAluguel: "1950",
        valorCondominio: "0",
        valorIptu: "95",
        diaVencimento: 5,
        inicio: new Date(agora.getFullYear() - 2, agora.getMonth() + 2, 1),
        // Encerra em ~2 meses: cai no aviso de vigência de 90 dias.
        fim: new Date(agora.getFullYear(), agora.getMonth() + 2, 1),
        indice: "ipca",
        taxaAdministracao: "8",
      },
    ])
    .returning();

  const mesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const comp = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  await db.insert(schema.parcelaAluguel).values([
    {
      idContrato: locacoes[0]!.idContrato,
      competencia: comp(mesPassado),
      vencimento: new Date(mesPassado.getFullYear(), mesPassado.getMonth(), 10),
      valorBase: "3460",
      estado: "paga",
      valorPago: "3460",
      pagoEm: new Date(mesPassado.getFullYear(), mesPassado.getMonth(), 9),
    },
    {
      // A atrasada: a varredura recalcula multa e juros e anda a régua de
      // cobrança em cima dela.
      idContrato: locacoes[1]!.idContrato,
      competencia: comp(mesPassado),
      vencimento: new Date(mesPassado.getFullYear(), mesPassado.getMonth(), 5),
      valorBase: "2045",
      estado: "atrasada",
    },
  ]);

  // Dois processos de escritura: um travado do nosso lado, outro sentado no
  // cartório — o par que a tela precisa pra mostrar a diferença entre
  // "trabalho" e "ligação".
  await db.insert(schema.processoEscritura).values([
    {
      idImovel: imoveis[8]!.idImovel,
      idComprador: clientes[2]!.idCliente,
      idVendedor: clientes[3]!.idCliente,
      etapa: "registro_protocolado",
      // 12 dias numa etapa nossa de prazo 3: vira tarefa acionável.
      etapaDesde: diasAtras(12),
      cartorioRegistro: "1o Oficial de Registro de Imoveis de Sorocaba",
      matricula: "84.229",
      valorItbi: "16920",
      documentosEntregues: ["escritura pública assinada por comprador, vendedor e tabelião"],
    },
    {
      idImovel: imoveis[9]!.idImovel,
      idComprador: clientes[6]!.idCliente,
      idVendedor: clientes[0]!.idCliente,
      etapa: "registro_concluido",
      // 58 dias no cartório: alerta, mas NÃO é tarefa nossa.
      etapaDesde: diasAtras(58),
      cartorioRegistro: "2o Oficial de Registro de Imoveis de Sorocaba",
      matricula: "91.744",
      valorItbi: "23560",
      documentosEntregues: [],
    },
  ]);

  console.log(
    [
      "seed pronto:",
      `  ${corretores.length} corretores (1 inativo)`,
      `  ${imoveis.length} imóveis em ${new Set(IMOVEIS.map((i) => i.bairro)).size} bairros`,
      `  ${dominios.length} domínios — 2 imóveis sem domínio nenhum (o caso que escala)`,
      `  ${clientes.length} clientes · 3 laudos · 8 anúncios`,
      `  ${locacoes.length} contratos de locação (1 com parcela atrasada)`,
      "  6 atendimentos no funil · 2 processos de escritura",
      "  2 cadastros que são a MESMA pessoa (Instagram + WhatsApp, sem campo em comum)",
      "",
      "imóveis com laudo esperando o Agente 1:",
      ...[3, 4, 5].map((n) => `  ${imoveis[n]!.idImovel}  ${IMOVEIS[n]!.bairro}`),
    ].join("\n"),
  );

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
