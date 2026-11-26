# BreadPilot behaviour simulator: `socket` on a Pico with no network (M18 18.7b): setting up works,
# reaching anything fails with OSError, as without a Wi-Fi connection.
import _bpsim

_bpsim.emit("unsimulated", "socket")


def _no_network(*args, **kwargs):
    raise OSError(-2)  # name or address not found: no network


AF_INET = 2
AF_INET6 = 10
SOCK_STREAM = 1
SOCK_DGRAM = 2
SOCK_RAW = 3
SOL_SOCKET = 1
SO_REUSEADDR = 4
IPPROTO_TCP = 6
IPPROTO_UDP = 17
getaddrinfo = _no_network


class socket:
    def __init__(self, *args, **kwargs):
        pass

    connect = _no_network
    bind = _no_network
    sendto = _no_network
    recv = _no_network
    recvfrom = _no_network
    send = _no_network
    write = _no_network
    read = _no_network

    def settimeout(self, t):
        pass

    def setsockopt(self, *args):
        pass

    def listen(self, *args):
        pass

    def close(self):
        pass
