"""GET /api/config — parâmetros de gestos servidos pelo backend Python (Vercel).

O front-end busca estes valores ao iniciar; se a API estiver fora do ar,
usa os padrões embutidos em public/engine.js. Para ajustar a sensibilidade
basta editar CONFIG e fazer um novo deploy.
"""
import json
from http.server import BaseHTTPRequestHandler

CONFIG = {
    "pinch_on": 0.30,
    "pinch_off": 0.45,
    "fist_hold": 1.0,
    "drag_move": 0.04,
    "dbl_window": 0.45,
    "scroll_gain": 1800,
    "mincutoff": 1.5,
    "beta": 8.0,
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(CONFIG).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600")
        self.end_headers()
        self.wfile.write(body)
