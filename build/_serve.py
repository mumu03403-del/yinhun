"""本地静态服务（仅用于验证，供非技术用户启动可玩版本）。

硬性规矩：
- 覆写 handle_one_request，静默吞掉 ConnectionAbortedError / ConnectionResetError / BrokenPipeError
- 日志做大小限制（滚动覆盖），避免无限堆栈打印撑爆日志
用法：python _serve.py [port] [root]
"""
import http.server
import os
import socketserver
import sys
import threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__))

LOG_PATH = os.path.join(ROOT, "_serve_access.log")
LOG_LIMIT = 256 * 1024
_log_lock = threading.Lock()
_log_size = 0


def log_line(line: str) -> None:
    global _log_size
    try:
        with _log_lock:
            if _log_size > LOG_LIMIT:
                with open(LOG_PATH, "w", encoding="utf-8") as f:
                    f.write("")
                _log_size = 0
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(line + "\n")
                _log_size += len(line) + 1
    except Exception:
        pass


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        log_line("%s - %s" % (self.address_string(), fmt % args))

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True
        except Exception:
            self.close_connection = True

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass
        except Exception:
            pass


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    os.chdir(ROOT)
    with ReusableServer(("0.0.0.0", PORT), QuietHandler) as httpd:
        print("serving %s at http://127.0.0.1:%d/" % (ROOT, PORT), flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
