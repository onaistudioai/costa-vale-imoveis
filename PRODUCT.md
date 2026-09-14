# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dois públicos, cada um com sua superfície:

- **Quem pode contratar a Onai**: donos e gestores de imobiliárias pequenas. Chegam pelo README, pelas imagens e por materiais de apresentação. O trabalho deles é entender em poucos minutos o que a automação resolve e se dá para confiar nela.
- **A equipe da imobiliária**: corretores e gerência que usam o painel no dia a dia. Decidem pedidos na fila, acompanham atendimentos, locação e escrituras, e perguntam sobre os números da operação.

## Product Purpose

Sistema de estoque, anúncio e atendimento para imobiliária, conduzido por seis agentes de IA sobre regras determinísticas. Resolve perdas de coordenação: imóvel pronto que nunca foi anunciado, mídia paga rodando em imóvel vendido, lead respondido tarde, cliente que some sem registro.

É projeto de portfólio da Onai, que vende automação e entrega no sistema do cliente. Funcional e pronto para rodar com dados de demonstração de Sorocaba, ainda sem cliente real e fora de produção.

## Positioning

- **IA lê, regra decide.** O modelo só extrai texto; toda decisão sai de código testável sem chave de API e sem banco.
- **Gente aprova o que importa.** Faixas de risco verde, amarela e vermelha, todas com aprovação; mesa de revisão para o caso amarelo; fila única de decisões humanas.
- **Entrega no sistema do cliente.** A implantação encaixa no que a empresa já usa, com período em sombra e virada de um agente por vez.
- **Segurança e auditoria.** Dados pessoais cifrados, trilha de quem decidiu assinada pela sessão, Row Level Security.

## Operating Context

- Painel web (Next.js) com as telas: fila, funil, locação, escrituras, alterar, consulta, mensagens, automático, semanas, cérebro e histórico por imóvel.
- Acesso por senha; o nome de quem decide sai da sessão.
- Canais externos (WhatsApp, e-mail) existem no código e ficam desligados fora de produção.
- Documentação em `README.md` e `docs/` (especificação, plano executivo, implantação, segurança, como rodar).

## Capabilities and Constraints

- Idioma: português do Brasil.
- Termos do domínio: laudo de vistoria, lead, corretor, carteira, vínculo, escritura, matrícula, locação, reajuste, faixa, mesa de revisão, fila.
- Sem deploy, WhatsApp real, hospedagem ou plano pago enquanto não houver cliente.
- Textos sem travessão e sem construções do tipo "não é X, é Y".
- Em aberto: marca, logo e identidade visual.

## Brand Commitments

Nenhuma fixa. "Costa & Vale Imóveis" é nome de demonstração. Nunca descrever o projeto como fictício.

## Evidence on Hand

- Sistema rodando localmente com dados de demonstração (`npm run seed`).
- 406 testes automatizados e aferição do modelo contra casos de referência (`npm run aferir`, última execução 26/26).
- Não existem clientes, depoimentos, métricas de produção nem casos reais. Nada disso pode ser inventado.

## Product Principles

1. Toda decisão com dinheiro ou cliente passa por uma pessoa.
2. O que o modelo erra precisa ficar visível e corrigível antes de virar ação.
3. Cada tela serve a quem decide; o dado mais urgente aparece primeiro.
4. Mostrar o que o sistema fez sozinho com a mesma clareza do que esperou aprovação.
5. Afirmar só o que o código prova.
