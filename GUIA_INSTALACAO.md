# COMEX QUIZ LIVE — FACDO

Quiz multiplayer de Comércio Exterior, para celulares, com 15 questões de 5 alternativas, ordem aleatória, ranking em tempo real e bônus de rapidez.

**Arquitetura:** GitHub Pages (site estático) + Firebase Authentication + Firebase Realtime Database (sincronização).
**Não funciona só com GitHub Pages:** o Firebase é indispensável para sincronizar alunos e pontuações.

## 1. O que há no pacote público

- `index.html`: página do aluno e painel do professor.
- `style.css`: interface responsiva.
- `app.js`: lógica do jogo e pontuação.
- `questions.js`: as 15 perguntas e alternativas **sem gabarito**.
- `firebase-config.js`: configuração pública do Firebase, a ser preenchida.
- `database.rules.json`: regras de segurança do banco, a serem personalizadas.
- `GUIA_INSTALACAO.md`: este manual.

O arquivo **`COMEX_Quiz_Live_GABARITO_PRIVADO.json` é entregue separadamente**. **NÃO envie esse arquivo ao GitHub**, nem ao Firebase Storage, nem aos alunos.

## 2. Configuração inicial (uma única vez)

### Passo A — Criar o Firebase

1. Entre em https://console.firebase.google.com e crie um projeto.
2. Em **Build → Authentication → Sign-in method**, habilite **Anonymous** e **Google**.
3. Em **Build → Realtime Database**, crie um banco. Se possível, comece em modo bloqueado e publique as regras do próximo passo.
4. Em **Configurações do projeto → Geral → Seus apps**, registre um aplicativo **Web** e copie os dados de configuração.
5. Abra `firebase-config.js` e substitua os valores de exemplo pelos valores do aplicativo Web. Em `databaseURL`, use a URL **exata** do Realtime Database criada no console. Não use a URL do Firestore.
6. Em `window.COMEX_PROFESSOR_EMAIL`, informe o e-mail Google do professor.

A configuração Web do Firebase (apiKey, projectId, databaseURL etc.) é pública por natureza; a proteção dos dados depende das **regras de segurança** e da autenticação. Não publique senhas.

### Passo B — Proteger o banco

1. Abra `database.rules.json`.
2. Substitua **todas** as ocorrências de `professor@exemplo.com` pelo **mesmo e-mail Google** do professor.
3. Copie o conteúdo completo do JSON.
4. No console Firebase, abra **Realtime Database → Rules**, cole o JSON e clique em **Publish**.

Essas regras:
- autorizam o professor verificado a administrar a sala, resultados e respostas;
- permitem ao aluno anônimo registrar **um apelido por sala** durante o lobby;
- permitem **uma resposta por questão**, dentro da janela de tempo;
- impedem que estudantes escrevam diretamente nas pontuações;
- não deixam o gabarito armazenado no banco durante a pergunta.

**Não use regras públicas como `.read: true` e `.write: true`.**

### Passo C — Publicar no GitHub Pages

1. Crie ou abra um repositório GitHub (ex.: `comex-quiz-live`).
2. Envie **somente os arquivos do pacote público** para a **raiz** do repositório.
3. Vá em **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**; branch `main`; pasta `/(root)`; salve.
5. Aguarde o GitHub publicar o endereço, normalmente:
   `https://SEU-USUARIO.github.io/comex-quiz-live/`
6. No Firebase, em **Authentication → Settings → Authorized domains**, acrescente `SEU-USUARIO.github.io` (sem `https://` e sem o caminho do repositório). Isso é necessário para o login Google do professor.

## 3. Como o professor conduz a aula

1. Abra o endereço do site com `?professor=1` ao final:
   `https://SEU-USUARIO.github.io/comex-quiz-live/?professor=1`
2. Clique em **Entrar com Google**, com o e-mail autorizado nas regras.
3. Na área **Gabarito privado**, selecione o arquivo `COMEX_Quiz_Live_GABARITO_PRIVADO.json` que você guardou no computador. Opcionalmente marque **Lembrar gabarito neste navegador** (apenas em dispositivo pessoal do professor), para não precisar importar novamente.
4. Clique em **Nova sala / zerar** (a primeira vez cria a sala).
5. Projete o QR Code mostrado no painel. O QR Code é gerado automaticamente a partir do endereço real do site.
6. Os alunos entram, escolhem um apelido e aguardam.
7. Clique em **Iniciar jogo**. As questões aparecem nos celulares.
8. Após cada pergunta, clique em **Mostrar resposta** e depois **Próxima pergunta**.
9. Ao final, clique em **Encerrar**. Use **Exportar ranking CSV** para salvar o resultado.

**Mantenha a aba do professor aberta e com o gabarito carregado durante o jogo**: ela calcula e publica os pontos. Se atualizar a página, importe o gabarito novamente (a menos que tenha optado por lembrá-lo neste navegador); as respostas já registradas no Firebase permitem recomputar o ranking.

## 4. Como os alunos participam

- Abrem o QR Code no celular, sem instalar aplicativo.
- Entram com apelido, sem informar nome completo ou e-mail.
- Escolhem **uma de cinco alternativas** em cada questão.
- Cada celular recebe as alternativas em ordem pseudoaleatória, diferente por aluno e pergunta.
- O ranking atualiza enquanto o professor mantém o painel ativo.
- Ao revelar a resposta, cada aluno vê a alternativa correta e uma explicação.

## 5. Regras de pontuação

- Resposta incorreta ou não enviada: **0 pontos**.
- Resposta correta: **1.000 pontos + bônus de até 500 pontos pela rapidez**.
- Bônus = `arredondar(500 × (1 − tempo_gasto / 20.000 ms))`, limitado entre 0 e 500.
- Tempo da resposta: calculado a partir dos **timestamps do servidor Firebase**, não do cronômetro declarado pelo aluno.
- Critérios de desempate: mais acertos; depois, menor soma dos tempos de resposta.

A pergunta fica aberta por aproximadamente 20 segundos (pequena margem de rede). Cada aluno só consegue enviar uma resposta por questão.

## 6. Segurança, limites e boas práticas

- A versão foi pensada para **atividade recreativa/formativa**, não para prova de alta segurança. Estudantes podem tentar criar várias contas anônimas, trocar de aparelho ou consultar fontes externas. Supervisione a dinâmica.
- Não use nomes completos, CPF, matrícula, notas oficiais ou dados sensíveis nos apelidos.
- O gabarito não é publicado no GitHub. Porém, o professor o carrega localmente; não projete o conteúdo do arquivo.
- O plano gratuito do Firebase tem limites de uso e de conexões simultâneas. Consulte as cotas do seu projeto e faça um teste com alguns celulares antes da aula.
- Se a escola tiver muitas dezenas de participantes, valide o limite de conexões simultâneas da modalidade escolhida.
- Ao terminar o mês, você pode excluir o Realtime Database e desativar o projeto Firebase.
- O botão **Nova sala / zerar** APAGA as respostas e a classificação da sala anterior. Exporte o ranking antes de usá-lo.

## 7. Solução de problemas

**O site diz 'Falta conectar o Firebase'.**  
Preencha `firebase-config.js` com as credenciais corretas e envie o arquivo atualizado ao GitHub.

**'Permission denied' ao entrar.**  
Confira o e-mail do professor nas regras, a publicação das regras, o login anônimo e o `databaseURL`.

**O login Google do professor não abre.**  
Confira o domínio autorizado `SEU-USUARIO.github.io`, o provedor Google habilitado e se o navegador bloqueia pop-ups.

**O QR Code não aparece.**  
Verifique a conexão com a internet; o QR usa uma biblioteca externa. Compartilhe o link escrito logo abaixo dele como alternativa.

**A pontuação não muda.**  
Mantenha o painel do professor aberto com o gabarito privado carregado. Se a aba recarregar, carregue o arquivo novamente.

**Os alunos não conseguem responder.**  
Confira se a sala está na etapa de pergunta, se o tempo não terminou e se o aluno entrou antes de o jogo começar.

---

**Contato/uso:** projeto acadêmico COMEX QUIZ LIVE, para revisão integradora de Comércio Exterior no curso de Administração.
