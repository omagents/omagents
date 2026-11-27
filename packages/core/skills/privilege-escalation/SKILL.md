---
name: privilege-escalation
description: "Run commands that need root from non-interactive agent shells. Trigger when sudo fails, hangs, times out, is denied, or reports no TTY or askpass, and for privileged work like system package installs, /etc or /usr edits, system services, mounts, and kernel modules. Provides a probe-first chain through sudo -n, pkexec, run0, and doas."
---

# Privilege Escalation for Agent Shells

Agent shells have no TTY. A bare `sudo` command blocks on a password prompt that
no one can type, hanging until the tool timeout kills it — and some hosts deny
`sudo` patterns outright before the command even runs. When a command needs
root, pick an escalation tool that works without a terminal instead of dying on
bare `sudo`.

## When to Use

- The command needs root: system package installs, writes to `/etc` or `/usr`,
  system `systemctl` units, mounts, user/group management, privileged
  `journalctl` reads.
- `sudo` already failed with "a terminal is required", "no askpass program",
  or "sudo: a password is required", or the command timed out.
- The host's permission rules denied the `sudo` pattern.

## Probe First, Then Escalate

Work down this chain in order:

```
Does the command elevate itself (sudo, pkexec, run0, doas, su, mount, …)?
  → Run it as-is. Never wrap a self-elevating command.
Else does `sudo -n true` succeed (passwordless, cached, or askpass configured)?
  → Run `sudo -n <command>`.
Else does `command -v pkexec` find pkexec?
  → Run `pkexec --disable-internal-agent <absolute-path> <args…>`.
Else does `command -v run0` find run0 (systemd 256+)?
  → Run `run0 <command>`.
Else does `command -v doas` find doas?
  → Run `doas -n <command>`.
Else
  → Print the exact command for the user to run manually. Stop.
```

`sudo -n` fails fast instead of hanging: it never prompts, so it is a safe
probe even when passwordless sudo is not configured. Check which tools exist
with `command -v pkexec; command -v run0; command -v doas` before committing to
one.

## pkexec Rules

`pkexec` escalates through Polkit, which shows a GUI password dialog the human
at the machine can approve — no terminal required. To use it correctly:

- **Pin the exact executable with an absolute path.** pkexec resets the child
  to a minimal safe environment whose `PATH` differs from yours, and the
  Polkit approval dialog shows the fully resolved program — so make the
  target unambiguous: resolve it first with `command -v pacman`, then run
  `pkexec /usr/bin/pacman -Syu`.
- **Pipes and redirections run as the calling user, not root.**
  `pkexec echo 'value' > /etc/example.conf` fails or writes a user-owned file.
  Write root files with `tee`:

  ```bash
  printf '%s\n' 'net.ipv4.ip_forward = 1' | pkexec tee /etc/sysctl.d/99-forward.conf
  ```

- **Compound commands** (pipes, redirections, `&&`) run as one root shell:

  ```bash
  pkexec sh -c 'cp /etc/hosts /etc/hosts.bak && printf "%s\n" "10.0.0.5 host" >> /etc/hosts'
  ```

- **Always pass `--disable-internal-agent`.** Without a polkit agent,
  pkexec registers its own textual agent that prompts on the controlling
  TTY — so in a shell that happens to inherit a TTY, plain `pkexec …` can
  block on a password prompt, the exact hang this skill exists to avoid.
  With the flag, pkexec either prompts through the desktop's GUI polkit
  agent or fails immediately. If a pkexec invocation ever visibly waits
  for input, abandon it rather than letting it run out the timeout.
- A polkit authentication agent must be running for the GUI prompt to
  appear, which is typical on desktop sessions. Headless servers and plain
  SSH sessions usually have none — pkexec fails there; fall through to
  `run0`, `doas`, or the manual step.
- GUI applications are not launchable under pkexec (`DISPLAY` and `XAUTHORITY`
  are dropped); it is for commands, not desktop apps.

## run0 and doas

- `run0` is systemd's replacement for `sudo` (systemd 256+). It authenticates
  through the same Polkit machinery as pkexec but keeps a saner environment
  and resolves the command by name, so no absolute-path pinning is needed.
  Use it when `sudo -n` fails but a polkit agent exists.
- `doas` is the OpenBSD-style alternative, configured in `/etc/doas.conf`.
  `doas -n` is its non-interactive form.

## Never

- **Never bare interactive `sudo`** in an agent shell — it hangs until the tool
  timeout kills it. If `sudo -n` fails, move down the chain.
- **Never pipe or embed a password**: `echo '<password>' | sudo -S …` leaks the
  secret into logs and history. If the user offers a password, refuse it and
  use a tool with a proper prompt instead.
- **Never edit sudoers or add NOPASSWD policy** just to unblock an agent — a
  permanent security weakening is not a fix for a convenience problem.
- **Never double-wrap**: `sudo pkexec …`, `pkexec sudo …`, or `run0 doas …`
  stack prompts and fail.
- **Never run destructive root commands** (`rm -rf`-class) without quoting the
  exact command to the user first and getting confirmation.

## Platform Notes

- **macOS**: only `sudo` exists. If `sudo -n` fails, hand the command to the
  user.
- **Windows**: no pkexec, run0, or doas. Privileged commands need an elevated
  shell the agent cannot open — always hand the command to the user.
- **Linux without a desktop session**: pkexec and run0 usually cannot prompt.
  Fall through to the manual step rather than looping.

## When Every Tool Fails

Print the exact command — absolute path, full arguments — for the user to run
in their own terminal, then stop. Do not retry escalation attempts in a loop:
each one either fails immediately (already probed) or hangs (already the
failure mode this skill avoids).
