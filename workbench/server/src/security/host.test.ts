import assert from "node:assert/strict";
import test from "node:test";

import { isLoopbackHost, localHostOnly } from "./host.js";

test("localHostOnly 空 / loopback 原样放行", () => {
	assert.equal(localHostOnly(undefined), "127.0.0.1");
	assert.equal(localHostOnly(""), "127.0.0.1");
	assert.equal(localHostOnly("  "), "127.0.0.1");
	assert.equal(localHostOnly("127.0.0.1"), "127.0.0.1");
	assert.equal(localHostOnly("localhost"), "localhost");
	assert.equal(localHostOnly("::1"), "::1");
});

test("localHostOnly 非法 host 一律降级回 127.0.0.1（不对局域网开放）", () => {
	// 0.0.0.0 会把本地 API 暴露到所有网卡，必须被拒
	assert.equal(localHostOnly("0.0.0.0"), "127.0.0.1");
	assert.equal(localHostOnly("192.168.1.5"), "127.0.0.1");
	assert.equal(localHostOnly("example.com"), "127.0.0.1");
});

test("isLoopbackHost 直接判别", () => {
	assert.equal(isLoopbackHost("127.0.0.1"), true);
	assert.equal(isLoopbackHost("localhost"), true);
	assert.equal(isLoopbackHost("::1"), true);
	assert.equal(isLoopbackHost("0.0.0.0"), false);
	assert.equal(isLoopbackHost("10.0.0.1"), false);
});
