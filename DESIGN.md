---
name: Costa & Vale Painel
description: Painel de decisões humanas e auditoria da operação imobiliária
colors:
  papel-quente: "#fbfaf8"
  folha: "#ffffff"
  linha-de-pauta: "#e4e0d8"
  tinta: "#1c1a17"
  tinta-gasta: "#6d675e"
  lacre: "#a8321e"
  ocre: "#9a6b12"
  musgo: "#2f6b45"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 700
    letterSpacing: "-0.015em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
rounded:
  controle: "7px"
  ficha: "10px"
  pilula: "999px"
spacing:
  xs: "0.4rem"
  sm: "0.9rem"
  md: "1.5rem"
  lg: "2rem"
components:
  button:
    backgroundColor: "{colors.folha}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.controle}"
    padding: "0.4rem 0.9rem"
  button-primario:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.papel-quente}"
    rounded: "{rounded.controle}"
    padding: "0.4rem 0.9rem"
  input:
    backgroundColor: "{colors.papel-quente}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.controle}"
    padding: "0.4rem 0.6rem"
  card:
    backgroundColor: "{colors.folha}"
    rounded: "{rounded.ficha}"
    padding: "1.1rem 1.25rem"
  pill:
    backgroundColor: "{colors.folha}"
    rounded: "{rounded.pilula}"
    padding: "0.2rem 0.7rem"
---

# Design System: Costa & Vale Painel

## Overview

**Creative North Star: "O Livro de Registro"**

O painel funciona como o livro de um cartório: papel claro e quente, tinta quase preta, e cada decisão anotada com data e autor. A página existe para que alguém decida com segurança, então a superfície fica calma e a tinta carrega a informação.

A densidade é de documento de trabalho. Uma coluna central de leitura, fichas empilhadas, linhas de pauta separando registros. A cor aparece como um carimbo: só quando algo pede ação ou confirma que foi feito. Não há sombras, gradientes nem ornamentos; a hierarquia vem do peso da tinta e da posição na página.

Tema escuro acompanha a preferência do sistema, invertendo papel e tinta e clareando os carimbos para manter o contraste.

**Key Characteristics:**
- Papel quente e tinta escura como base de tudo.
- Cor reservada para estado: lacre, ocre e musgo.
- Plano, com profundidade dada por borda fina e tom.
- Uma coluna de leitura de até 62rem.
- Números tabulares em datas, prazos e valores.

## Colors

Paleta de papelaria: neutros quentes com três pigmentos de estado.

### Primary
- **Tinta** (#1c1a17): texto principal, botão primário e o passo atual da esteira. É a voz do registro.

### Secondary
- **Lacre** (#a8321e): urgência. Faixa vermelha, custo de não decidir, alertas. Marca o que queima.
- **Ocre** (#9a6b12): atenção. Faixa amarela, casos que passam pela mesa de revisão.
- **Musgo** (#2f6b45): concluído. Etapas feitas e estados em ordem.

### Neutral
- **Papel Quente** (#fbfaf8): fundo da página e dos campos de entrada.
- **Folha** (#ffffff): fichas, botões e pílulas, levemente acima do papel.
- **Linha de Pauta** (#e4e0d8): bordas, divisórias de tabela e da linha do tempo.
- **Tinta Gasta** (#6d675e): texto secundário, metadados, cabeçalhos de tabela, quem e quando.

### Named Rules
**The Carimbo Rule.** Lacre, ocre e musgo só aparecem para comunicar estado. Nunca como decoração, fundo de área ou destaque de marca.

**The Rótulo Junto Rule.** Cor de estado sempre vem acompanhada de texto que diz o estado. A barra lateral ordena num relance; o rótulo carrega o significado.

## Typography

**Body Font:** fonte do sistema (ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif)

**Character:** Uma família só, a do sistema operacional, para o painel parecer ferramenta da casa e carregar rápido. A hierarquia vem de peso e tamanho, com contraste pequeno entre níveis.

### Hierarchy
- **Headline** (700, 1.4rem, tracking -0.015em): título de cada tela, um por página.
- **Title** (600, 1rem): títulos de seção (h2) e o tipo de cada ficha.
- **Body** (400, 15px, 1.55): texto corrido e descrição das fichas, em Tinta Gasta dentro das fichas.
- **Label** (400, 0.85rem): metadados, datas, autor, pílulas e rótulos de faixa.

### Named Rules
**The Número Alinhado Rule.** Datas, prazos, custos e contagens usam `font-variant-numeric: tabular-nums` para as colunas lerem como livro-caixa.

## Layout

Coluna central com largura máxima de 62rem, margem lateral de 1.5rem e respiro de 2rem no topo e 4rem no pé. O cabeçalho ocupa a largura toda, com a marca e a navegação em linha, separado por uma linha de pauta.

Fichas empilham com 0.9rem entre si. Ações ficam em linha no pé da ficha com 0.5rem de intervalo. Tabelas ocupam a largura da coluna e ganham rolagem horizontal própria quando não cabem. Pílulas e esteira quebram linha em telas estreitas.

## Elevation & Depth

Totalmente plano. Nenhuma sombra em lugar nenhum. A profundidade vem de dois tons (Folha sobre Papel Quente) e de bordas de 1px em Linha de Pauta.

### Named Rules
**The Página Plana Rule.** Nada flutua. Estado se mostra com borda e tinta, nunca com sombra ou elevação.

## Shapes

Cantos suaves e consistentes: 7px em controles (botão, campo, seleção), 10px nas fichas, pílula completa em etiquetas e passos da esteira. Bordas finas de 1px em tudo. A única borda grossa é a barra lateral de 3px das fichas, que carrega faixa e urgência.

## Components

### Buttons
Discretos e firmes.
- **Shape:** cantos suaves (7px).
- **Padrão:** Folha com borda Linha de Pauta e texto Tinta, padding 0.4rem 0.9rem, herda a fonte.
- **Hover:** a borda escurece para Tinta Gasta.
- **Primário:** fundo Tinta com texto Papel Quente. Um por grupo de ações, na ação que resolve o pedido.

### Chips (pílulas)
- **Style:** Folha, borda Linha de Pauta, 0.85rem, pílula completa.
- **State:** variante alerta com borda e texto Lacre; variante ok com Musgo.

### Cards / Containers (fichas)
- **Corner Style:** 10px.
- **Background:** Folha.
- **Shadow Strategy:** nenhuma, ver Elevation & Depth.
- **Border:** 1px Linha de Pauta; barra lateral de 3px em Lacre (vermelha, urgente), Ocre (amarela) ou Linha de Pauta com opacidade 0.85 (acompanhamento).
- **Internal Padding:** 1.1rem 1.25rem.

### Inputs / Fields
- **Style:** fundo Papel Quente, borda 1px Linha de Pauta, 7px, padding 0.4rem 0.6rem.
- **Focus:** anel de foco nativo do navegador.

### Navigation
- **Style:** links em linha no cabeçalho, cor herdada, sem sublinhado; sublinha no hover. Marca em peso 620.

### Linha do Tempo
Signature do Livro de Registro. Lista sem marcadores, cada registro em uma linha com pauta embaixo: quando (tabular, 9.5rem de largura mínima), o que aconteceu, e quem.

### Esteira
Passos da escritura como pílulas em linha: feitos em Musgo, o atual em Tinta com peso 600, os futuros em Tinta Gasta.

### Proposta da Mesa
Citação recuada com borda esquerda de 2px em Linha de Pauta e texto em 0.92rem, para a sugestão da mesa ler como anotação à margem.

## Do's and Don'ts

### Do:
- **Do** manter o fundo em Papel Quente (#fbfaf8) e o texto em Tinta (#1c1a17).
- **Do** usar a barra lateral de 3px para faixa e urgência, sempre com rótulo em texto.
- **Do** usar números tabulares em datas, prazos e valores.
- **Do** registrar quem e quando em Tinta Gasta, 0.85rem, ao lado de cada ação.
- **Do** manter um único botão primário por grupo de ações.

### Don't:
- **Don't** adicionar sombras, gradientes ou fundos coloridos em áreas.
- **Don't** usar Lacre, Ocre ou Musgo fora de estado.
- **Don't** introduzir uma segunda família tipográfica no painel.
- **Don't** passar a largura de leitura de 62rem para texto e fichas.
