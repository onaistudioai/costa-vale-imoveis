# Como rodar

```bash
npm install
# crie um .env com DATABASE_URL e GROQ_API_KEY

# As duas chaves da PII. Diferentes entre si, 32 bytes cada. Guarde-as: sem a
# PII_KEY os dados cifrados não voltam.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # PII_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # PII_INDEX_KEY

npm run db:migrate        # aplica as migrations, RLS incluso
npm run acesso -- seunome # gera a senha do painel e a linha do PAINEL_USUARIOS
npm run seed              # estoque de demonstração de Sorocaba
npm run dev               # http://localhost:3000
```

Os testes de integração usam um **banco separado** (`TEST_DATABASE_URL`, um
branch do Neon). Sem essa variável eles se marcam como pulados — a suíte apaga
tabelas a cada teste, e apontá-la para o banco de trabalho apaga o estoque.

A suíte roda **sem chave de API e sem banco** — os testes de unidade injetam um
extrator falso, e os de integração se marcam como `skipped` quando não há
`DATABASE_URL`.

```bash
npm test          # 406 testes
npm run typecheck
cd servicos/mesa && uv run pytest   # a mesa, em Python
```

A mesa de revisão é opcional para rodar o resto. Sem `MESA_URL`, o caso amarelo
vai direto pra fila; com ela:

```bash
npm run mesa        # sobe o serviço em http://localhost:8001
```

Scripts de demonstração:

```bash
npm run varredura   # o que o tempo passou: prazos, aluguéis, cartórios
npm run recepcao    # a mesma pessoa chegando por dois canais diferentes
npm run perguntar -- "quanto estou gastando em mídia paga agora?"
npm run procedencia  # qual modelo e qual versão de prompt produziram cada leitura
npm run aferir       # os casos de referência (Curador, Guardião, Alterador) contra o modelo real
npm run propor-casos # transforma leituras negadas no painel em candidatos a caso de referência
npm run simular      # o custo do lead sem dono, com a rotina real do corretor
```

Num banco que já tem dados de antes da criptografia, uma vez só:

```bash
npm run cifrar-pii              # modo seco: diz o que faria
npm run cifrar-pii -- aplicar   # grava, numa transação só
```


## Estrutura

```
app/          telas e rotas de API
src/regras/   regras puras — sem banco, sem modelo, 100% testáveis
src/agentes/  os seis agentes
src/grafo/    o grafo, o despachante e o contrato de coordenação
src/lib/      banco, varredura, recepção, consultas do painel
src/mesa/     cliente da mesa de revisão: quando chamar e o que lembrar
src/afericao/ casos de referência e a conferência contra o modelo
servicos/mesa/ a mesa de revisão em Python (CrewAI)
docs/         especificação, plano executivo, implantação e calibração
drizzle/      migrations
```

A separação que sustenta o resto: **`src/regras/` não importa banco nem modelo.**
É o que permite testar a decisão de negócio isolada da infraestrutura.
