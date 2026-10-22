"""One NDJSON record per received weight report; never poll read_state().

DirectBalanceBoard's parser is a private API, deliberately pinned in requirements.
This bridge owns the connection: do not run the wiibalance daemon concurrently.
"""
import json
import os
import queue
import signal
import sys
import time
import uuid


def emit(value):
    sys.__stdout__.write(json.dumps(value, allow_nan=False) + "\n")
    sys.__stdout__.flush()


def calibrate(raw, calibration):
    kg = []
    for index, value in enumerate(raw):
        zero, mid, high = [row[index] for row in calibration]
        if not zero < mid < high:
            raise ValueError("Calibración de fábrica inválida")
        kg.append(17 * (value-zero)/(mid-zero) if value < mid else 17 + 17*(value-mid)/(high-mid))
    return kg


def main():
    if sys.platform != "linux":
        emit({"type": "status", "message": "El puente Wii requiere Linux. Usá SOURCE=toolkit o simulador en Mac."})
        return 1

    from wiibalance import DirectBalanceBoard

    # The upstream worker also prints diagnostics from a background thread.
    # Reserve the original stdout exclusively for our NDJSON protocol.
    sys.stdout = sys.stderr

    readings = queue.Queue(maxsize=512)
    stopped = False

    def stop(*_):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    class StreamingBoard(DirectBalanceBoard):
        def __init__(self):
            self.stream_id = str(uuid.uuid4())
            self.discarded = 0
            super().__init__(address=os.environ.get("WII_ADDRESS"), timeout=5)

        def _parse_sample_packet(self, packet):
            captured = time.monotonic_ns() / 1_000_000
            weights = super()._parse_sample_packet(packet)
            if not all(self.calibration_completed[:2]):
                return weights
            # Convert the original counts ourselves: never depend on the user's
            # wiibalance metric/imperial preference or its below-zero clamp.
            raw = [int.from_bytes(packet[i:i+2], "big") for i in (4, 6, 8, 10)]
            kg = calibrate(raw, self.calibration)
            if readings.full():
                readings.get_nowait()
                self.discarded += 1
            readings.put_nowait({
                "boardId": self.address, "streamId": self.stream_id,
                "capturedAtMonoMs": captured,
                "kg": dict(zip(("tr", "br", "tl", "bl"), kg)),
                "raw": dict(zip(("tr", "br", "tl", "bl"), raw)),
                "batteryPercent": None, "discarded": self.discarded,
            })
            return weights

    board = None
    try:
        # Upstream may print diagnostics; stdout must remain valid NDJSON.
        import contextlib
        with contextlib.redirect_stdout(sys.stderr):
            board = StreamingBoard()
        while not stopped and board.connected:
            try:
                value = readings.get(timeout=0.25)
            except queue.Empty:
                continue
            state = board.read_state()
            value["batteryPercent"] = state.battery_percent
            emit(value)
    except Exception as exc:
        emit({"type": "status", "message": f"Wii: {exc}"})
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        if board is not None:
            board.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
