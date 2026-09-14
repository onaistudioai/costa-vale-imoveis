# Diagramas UML (PlantUML)

Fonte dos diagramas do sistema. A versão explicada em texto está em [`../UML-COMPLETO.md`](../UML-COMPLETO.md).

| Arquivo | O que mostra |
|---|---|
| `01-componentes.puml` | Componentes do sistema e como se ligam |
| `02-entidades.puml` | Entidades do banco e relacionamentos |
| `03-agentes.puml` | Contrato comum e os agentes que o implementam |
| `04-estados-imovel-aprovacao.puml` | Estados do imóvel e da aprovação |
| `05-estados-atendimento-locacao-cerebro.puml` | Estados do atendimento, da locação e do cérebro |
| `06-estados-escritura.puml` | Estados da escritura |
| `07-sequencia-curador.puml` | Sequência do Curador |
| `08-sequencia-guardiao.puml` | Sequência do Guardião |
| `09-sequencia-lead.puml` | Caminho do lead, do Atendimento ao Roteador |
| `10-sequencia-alterador.puml` | Sequência do Alterador |
| `11-sequencia-consulta.puml` | Sequência de uma consulta |

## Gerar as imagens

Precisa de Java e do `plantuml.jar` ([plantuml.com/download](https://plantuml.com/download)).

```bash
java -jar plantuml.jar -tsvg docs/uml/*.puml
```

Troque `-tsvg` por `-tpng` para PNG. No VS Code, a extensão PlantUML mostra a prévia com `Alt+D`.
