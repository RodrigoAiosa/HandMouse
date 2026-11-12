# ✋ HandMouse

Controle o cursor com a mão, usando só a webcam. O [MediaPipe](https://ai.google.dev/edge/mediapipe) reconhece a mão; o resto (gestos, suavização, congelar na pinça, arrastar no macOS) é feito aqui.

| Gesto | Ação |
|---|---|
| Indicador esticado | Move o cursor |
| Pinça indicador + polegar | Clique |
| Duas pinças rápidas | Duplo clique |
| Pinça com dedo médio + polegar | Clique direito |
| Segurar a pinça e mexer a mão | Arrastar e soltar |
| “V” com dois dedos e subir/descer a mão | Rolar a página |
| Punho fechado por 1 s | Pausa / retoma tudo (para poder digitar) |

## Duas versões

### 1. Web (`public/` + `api/`) — roda no Vercel
Abra o site, clique em **Ativar câmera** e o navegador pergunta a permissão na primeira vez. O vídeo é processado **localmente no navegador** (MediaPipe Tasks Vision / WASM); nada é enviado ao servidor.

> ⚠️ **Limitação do navegador:** uma página web não pode mover o mouse real do sistema. Na versão web o cursor é *virtual* e controla **a própria página** (cliques, arrastar, rolar, menu de contexto). Para controlar o computador inteiro use a versão desktop.

O backend Python do Vercel (`api/config.py`) serve os parâmetros de sensibilidade em `/api/config`; se estiver fora do ar o front usa os padrões.

**Deploy:** importe o repositório em [vercel.com/new](https://vercel.com/new) (sem build, sem configuração) ou rode `vercel --prod`. Requer HTTPS — o Vercel já fornece.

Rodar local: `npx vercel dev` (ou `python3 -m http.server -d public`; a câmera funciona em `localhost`).

### 2. Desktop (`desktop/`) — controla o mouse real
```bash
cd desktop
python3 -m venv .venv && source .venv/bin/activate   # Python 3.9–3.12
pip install -r requirements.txt
python handmouse.py
```
`ESC` pausa/retoma · `Q` sai. No macOS, dê permissão de **Câmera** e **Acessibilidade** ao Terminal (Ajustes › Privacidade e Segurança).

## Como funciona (o que vem depois do MediaPipe)
- **Tremor:** filtro *One Euro* — firme com a mão parada, rápido quando você move.
- **Cursor escorregando ao pinçar:** ao detectar a pinça o cursor volta ~150 ms no tempo e fica congelado até soltar.
- **Arrastar:** só começa se a mão se mover com a pinça fechada; senão é clique ao soltar.
- **macOS:** o arraste usa eventos `LeftMouseDragged` do Quartz, porque `mouseDown`/`moveTo` comuns não são reconhecidos como arraste.
- **Histerese** na pinça (fecha em 0,30 / abre em 0,45 da palma) evita cliques duplicados.

A lógica de gestos fica em `desktop/gestures.py` (sem dependências) e é espelhada em `public/engine.js`. Ajuste os limiares em `DEFAULTS` nos dois lugares (ou em `api/config.py` para a web).

## Testes
```bash
python3 -m unittest discover -s tests    # motor Python
node tests/engine.test.mjs               # motor JS
```

## Estrutura
```
public/   index.html, app.js, engine.js, style.css   → site estático
api/      config.py                                  → função Python (Vercel)
desktop/  handmouse.py, gestures.py, requirements.txt
tests/
vercel.json   (Permissions-Policy: camera=(self))
```
