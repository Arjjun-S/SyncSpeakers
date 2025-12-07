const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const WebSocket = require("ws");
const { createSignalingServer } = require("..");

let server;
let port;

const waitFor = (ws, type, timeoutMs = 2000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${type}`)),
      timeoutMs
    );
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch (err) {
        // ignore
      }
    };
    ws.on("message", handler);
  });

const connectSocket = () =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", (err) => reject(err));
  });

const registerClient = async (ws, { roomId, clientId, role, displayName }) => {
  const registered = waitFor(ws, "registered", 2000);
  ws.send(
    JSON.stringify({
      type: "register",
      roomId,
      clientId,
      displayName,
      role,
    })
  );
  return registered;
};

const closeSocket = (ws) =>
  new Promise((resolve) => {
    ws.once("close", () => resolve());
    ws.close();
    // Failsafe in case close event never fires
    setTimeout(resolve, 300);
  });

const expectNoMessage = (ws, type, timeoutMs = 400) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      resolve();
    }, timeoutMs);

    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.off("message", handler);
          reject(new Error(`Unexpected message of type ${type}`));
        }
      } catch (err) {
        // ignore
      }
    };

    ws.on("message", handler);
  });

const inviteSpeaker = async (host, roomId, targetId) => {
  host.send(
    JSON.stringify({
      type: "invite",
      roomId,
      from: "host-1",
      to: targetId,
      payload: { role: "speaker" },
    })
  );
  return waitFor(host, "invite-sent", 2000);
};

beforeEach(async () => {
  server = createSignalingServer({ port: 0 });
  port = server.port;
});

afterEach(async () => {
  // Ensure all sockets and server shut down to avoid hanging handles
  // No persistent sockets stored; server.close will terminate remaining clients
  if (server) {
    await server.close();
    server = null;
    port = undefined;
  }
});

test("invite flow upgrades speaker role", async () => {
  const roomId = "ROOM1";
  const host = await connectSocket();
  const speaker = await connectSocket();

  const hostRegistered = await registerClient(host, {
    roomId,
    clientId: "host-1",
    role: "host",
    displayName: "host",
  });
  assert.equal(hostRegistered.role, "host");

  await registerClient(speaker, {
    roomId,
    clientId: "speaker-1",
    role: "idle",
    displayName: "speaker",
  });
  await waitFor(host, "clients-updated");

  host.send(
    JSON.stringify({
      type: "invite",
      roomId,
      from: "host-1",
      to: "speaker-1",
      payload: { role: "speaker" },
    })
  );

  const invite = await waitFor(speaker, "invite");
  assert.equal(invite.from, "host-1");

  const inviteSent = await waitFor(host, "invite-sent");
  assert.equal(inviteSent.to, "speaker-1");

  const inviteResponsePromise = waitFor(host, "invite-response", 2000);
  const clientsUpdatedAfterAccept = waitFor(host, "clients-updated", 2000);

  speaker.send(
    JSON.stringify({
      type: "invite-response",
      roomId,
      from: "speaker-1",
      to: "host-1",
      accepted: true,
    })
  );

  const response = await inviteResponsePromise;
  assert.equal(response.accepted, true);

  const updated = await clientsUpdatedAfterAccept;
  const speakerEntry = updated.clients.find((c) => c.clientId === "speaker-1");
  assert.equal(speakerEntry.role, "speaker");

  await Promise.all([closeSocket(host), closeSocket(speaker)]);
});

test("decline keeps speaker idle", async () => {
  const roomId = "ROOM2";
  const host = await connectSocket();
  const speaker = await connectSocket();

  await registerClient(host, {
    roomId,
    clientId: "host-1",
    role: "host",
    displayName: "host",
  });

  await registerClient(speaker, {
    roomId,
    clientId: "speaker-2",
    role: "idle",
    displayName: "speaker-2",
  });

  const invitePromise = waitFor(speaker, "invite", 2000);
  const inviteSent = inviteSpeaker(host, roomId, "speaker-2");

  const invite = await invitePromise;
  assert.equal(invite.from, "host-1");
  await inviteSent;

  const inviteResponsePromise = waitFor(host, "invite-response", 2000);

  speaker.send(
    JSON.stringify({
      type: "invite-response",
      roomId,
      from: "speaker-2",
      to: "host-1",
      accepted: false,
    })
  );

  const response = await inviteResponsePromise;
  assert.equal(response.accepted, false);

  // Host should not receive a clients-updated for a decline
  await expectNoMessage(host, "clients-updated", 500);

  await Promise.all([closeSocket(host), closeSocket(speaker)]);
});

test("host can cancel pending invite", async () => {
  const roomId = "ROOM3";
  const host = await connectSocket();
  const speaker = await connectSocket();

  await registerClient(host, {
    roomId,
    clientId: "host-1",
    role: "host",
    displayName: "host",
  });

  await registerClient(speaker, {
    roomId,
    clientId: "speaker-3",
    role: "idle",
    displayName: "speaker-3",
  });

  const invitePromise = waitFor(speaker, "invite", 2000);
  const cancelPromise = waitFor(speaker, "invite-cancelled", 2000);
  const inviteSent = inviteSpeaker(host, roomId, "speaker-3");
  assert.equal((await inviteSent).to, "speaker-3");

  const inviteMsg = await invitePromise;
  const inviteId = inviteMsg.inviteId;

  host.send(
    JSON.stringify({
      type: "invite-cancel",
      inviteId,
      from: "host-1",
    })
  );

  const cancelled = await cancelPromise;
  assert.equal(cancelled.inviteId, inviteId);

  await Promise.all([closeSocket(host), closeSocket(speaker)]);
});
