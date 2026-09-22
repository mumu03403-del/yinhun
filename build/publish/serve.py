"""Local dev server for build/publish — port 8080.

Per user iron rule: override handle_one_request to silently swallow
client-disconnect exceptions (ConnectionAbortedError etc.) so the log
cannot balloon from repeated connection resets.
"""
import http.server
import socketserver
import os
import sys


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def log_message(self, fmt, *args):
        sys.stdout.write("[serve] " + (fmt % args) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", 8080), QuietHandler) as httpd:
        print("[serve] serving on http://localhost:8080  (Ctrl+C to stop)")
        sys.stdout.flush()
        httpd.serve_forever()
