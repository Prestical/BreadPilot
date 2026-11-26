# BreadPilot behaviour simulator: `ssl` on a Pico with no network (M18 18.7b): setting up works,
# reaching anything fails with OSError, as without a Wi-Fi connection.
import _bpsim

_bpsim.emit("unsimulated", "ssl")


def _no_network(*args, **kwargs):
    raise OSError(-2)  # name or address not found: no network


wrap_socket = _no_network


class SSLContext:
    def __init__(self, *args, **kwargs):
        pass

    wrap_socket = _no_network
