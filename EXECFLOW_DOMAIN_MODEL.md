# EXECFLOW: Domain Model

## Core Entities

### 1. CaseLegalFacts
O único input jurídico que o motor processa. Ele amalgama os eventos da timeline e as sentenças ativas em uma única estrutura no momento (Snapshot temporal) em que a avaliação ocorre.
- **sentences**: Array com tipificações de crimes (comum, hediondo) e reincidência.
- **incidents**: Faltas graves, saídas temporárias, atestados de conduta.
- **baselines**: Datas base calculadas dinamicamente.

### 2. Evaluators (Progression, Parole, Remission)
A lógica isolada de um tipo de benefício.
- **Rule Resolver**: Lê as Regras do Playbook e cruza com os crimes do Fato. Responde a pergunta: "Qual a regra legal e fração que se aplica para esse preso?"
- **Calculator**: Faz a matemática nua e crua (ex: Dias já cumpridos + Dias remidos vs. Fração Necessária).
- **Assessment**: Checa travas (ex: bloqueios por ausência de atestado de comportamento).

### 3. Playbook
A estrutura que mapeia a legislação.
Em vez de programar "O artigo 112 diz X", o Playbook armazena JSONs dizendo:
`"rule_type": "progression", "condition": "isHeinous == true", "fraction": 0.4`

### 4. Evaluation Registry & Opportunity
- **BenefitEvaluation**: Objeto de memória com rastreabilidade completa gerado pelo Evaluator.
- **Opportunity**: A tabela no banco de dados que expõe essa oportunidade ao usuário, contendo janelas de tempo, status de bloqueio, revisões do advogado e justificativas textuais (rationale).
