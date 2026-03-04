import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import { ChildProcess } from "child_process";

import { SidecarLifecycleCore } from "./sidecarLifecycleCore";

class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    kills: Array<NodeJS.Signals | number | undefined> = [];
    onKill?: (signal: NodeJS.Signals | number | undefined) => void;

    kill(signal?: NodeJS.Signals | number): boolean {
        this.kills.push(signal);
        this.onKill?.(signal);
        return true;
    }

    asChildProcess(): ChildProcess {
        return this as unknown as ChildProcess;
    }
}

test("SidecarLifecycleCore probes health endpoint via shared HTTP helper", async () => {
    const core = new SidecarLifecycleCore({
        readPort: () => 4312,
        readToken: () => "token",
        httpGet: async (_port, urlPath) => {
            assert.equal(urlPath, "/api/v1/health");
            return JSON.stringify({ status: "ok" });
        },
    });

    assert.equal(await core.isRunning(), true);
});

test("SidecarLifecycleCore waitForReady times out when child never becomes healthy", async () => {
    const core = new SidecarLifecycleCore({
        readPort: () => null,
        readToken: () => null,
    });
    const child = new FakeChild();
    core.attachChild(child.asChildProcess());

    const ready = await core.waitForReady(25, 5);
    assert.equal(ready, false);
    assert.equal(core.ownedByUs, true);
    assert.equal(core.hasManagedChild, true);
});

test("SidecarLifecycleCore waitForReady stops when managed process exits", async () => {
    const core = new SidecarLifecycleCore({
        readPort: () => null,
        readToken: () => null,
    });
    const child = new FakeChild();
    core.attachChild(child.asChildProcess());

    setTimeout(() => {
        child.emit("exit", 1, null);
    }, 10);

    const ready = await core.waitForReady(200, 5);
    assert.equal(ready, false);
    assert.equal(core.hasManagedChild, false);
});

test("SidecarLifecycleCore stop enforces ownership semantics and clears state", async () => {
    const core = new SidecarLifecycleCore({
        readPort: () => null,
        readToken: () => "tok",
    });
    const child = new FakeChild();
    child.onKill = (signal) => {
        if (signal === "SIGTERM") {
            setTimeout(() => {
                child.emit("exit", 0, null);
            }, 1);
        }
    };

    core.attachChild(child.asChildProcess());
    assert.equal(core.ownedByUs, true);

    await core.stop({ sigkillAfterMs: 20, hardDeadlineMs: 50 });

    assert.deepEqual(child.kills, ["SIGTERM"]);
    assert.equal(core.ownedByUs, false);
    assert.equal(core.hasManagedChild, false);

    core.markUsingExternalProcess();
    await core.stop({ sigkillAfterMs: 5 });
    assert.deepEqual(child.kills, ["SIGTERM"]);
});
