# BreadPilot behaviour simulator: `requests` (frozen into the Pico 2 W firmware) with no network:
# every request fails with OSError, as without a Wi-Fi connection (M18 18.7b).
import _bpsim

_bpsim.emit("unsimulated", "requests")


def request(method, url, *args, **kwargs):
    raise OSError(-2)


def get(url, *args, **kwargs):
    return request("GET", url)


def post(url, *args, **kwargs):
    return request("POST", url)


def put(url, *args, **kwargs):
    return request("PUT", url)


def delete(url, *args, **kwargs):
    return request("DELETE", url)


def head(url, *args, **kwargs):
    return request("HEAD", url)


def patch(url, *args, **kwargs):
    return request("PATCH", url)
