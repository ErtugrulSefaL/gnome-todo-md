#!/usr/bin/env bash
#
# vm-bootstrap-ssh.sh — make a test VM reachable by the host without its console.
#
# WHY: a test VM is only usable from the host once it has an SSH server (so the
# whole install + probe side of the work can be driven remotely) and, better, a
# qemu-guest-agent (so even privileged commands can be sent through
# `virsh qemu-agent-command`). A fresh guest has neither, and a guest console has
# no clipboard — so this is a ONE-TIME bootstrap, run inside the VM.
#
# It installs `openssh-server` + `qemu-guest-agent`, enables both, and adds the
# host's public key to the desktop user's `authorized_keys`. Apt is tried with
# the VM's own sources first; only if `openssh-server` has no candidate does it
# repoint apt at old-releases.ubuntu.com — an EOL release has been moved off
# archive.ubuntu.com, and the URL-only rewrite on its own is not enough: such an
# image can hold several half-migrated source fragments (a `.sources`, a curtin
# original, a tiny `sources.list`) and apt then reads a malformed
# suite/component list, which shows up as "no installation candidate" even
# though `apt-get update` succeeds. The existing files are therefore moved aside
# and replaced by one clean deb822 file.
#
# USAGE (inside the VM, root; two short lines, no copying)
#   sudo mount -t virtiofs todomd /mnt
#   sudo bash /mnt/tools/vm-bootstrap-ssh.sh
#
# 9p fallback if virtiofs is unavailable:
#   sudo mount -t 9p -o trans=virtio,version=9p2000.L todomd /mnt
#
# The report lands on the share as <repo>/.vm/bootstrap-report.txt, which the
# host reads directly. The host key below is baked in on purpose: the script has
# to run in a guest that cannot reach the host's ~/.ssh.
#
set -u

MNT=/mnt
OUT="$MNT/.vm/bootstrap-report.txt"
HOST_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFPf3JG0S3an3iY4UFNvNv5mMt+/UEw4FcTZq22THtkX "

{
    echo "=== bootstrap report — $(date -Is) ==="
    . /etc/os-release 2>/dev/null
    echo "os: ${PRETTY_NAME:-?} (codename ${VERSION_CODENAME:-?})"
    echo "kernel: $(uname -r)"
    CODENAME="${VERSION_CODENAME:-}"
    PKGS="openssh-server qemu-guest-agent"

    echo "--- before ---"
    echo "sshd: $(command -v sshd || echo MISSING)"
    echo "ssh: $(systemctl is-enabled ssh 2>&1) / $(systemctl is-active ssh 2>&1)"
    echo "qemu-guest-agent: $(systemctl is-active qemu-guest-agent 2>&1)"
    echo "network: $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}' | tr '\n' ' ')"

    echo "--- apt update on the VM's own sources ---"
    apt-get update -o Acquire::Retries=3 2>&1 | tail -4
    echo "update rc: ${PIPESTATUS[0]}"

    if apt-cache policy openssh-server 2>/dev/null | grep -qE 'Candidate: [0-9]'; then
        echo "candidate present — the VM's own sources work"
    else
        echo "--- no candidate: this is an EOL release, repointing apt ---"
        for f in /etc/apt/sources.list /etc/apt/sources.list.d/*; do
            [ -f "$f" ] || continue
            echo "----- $f (moved aside, was:)"
            sed 's/^/  | /' "$f"
            mv "$f" "$f.disabled"
        done
        cat > /etc/apt/sources.list.d/oldreleases.sources <<EOF
Types: deb
URIs: http://old-releases.ubuntu.com/ubuntu/
Suites: $CODENAME ${CODENAME}-updates ${CODENAME}-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
        echo "----- written: /etc/apt/sources.list.d/oldreleases.sources"
        sed 's/^/  | /' /etc/apt/sources.list.d/oldreleases.sources
        apt-get update -o Acquire::Retries=3 2>&1 | tail -4
        echo "update rc: ${PIPESTATUS[0]}"
        apt-cache policy openssh-server qemu-guest-agent 2>&1 \
            | grep -E '^[a-z-]+:|Candidate:'
    fi

    echo "--- install: $PKGS ---"
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $PKGS 2>&1 | tail -8
    install_rc=${PIPESTATUS[0]}
    echo "install rc: $install_rc"

    if [ "$install_rc" -ne 0 ]; then
        # A flaky mirror can still serve the .debs themselves; fetch them and let
        # dpkg place them, then repair anything still missing from the repo.
        echo "--- fallback: apt-get download + dpkg -i ---"
        cd /tmp || exit 1
        rm -f ./*.deb
        # shellcheck disable=SC2086
        apt-get download $PKGS openssh-sftp-server 2>&1 | tail -4
        ls -1 ./*.deb 2>/dev/null
        dpkg -i ./*.deb 2>&1 | tail -8
        DEBIAN_FRONTEND=noninteractive apt-get -f install -y 2>&1 | tail -4
    fi

    echo "--- enable the services ---"
    systemctl enable --now ssh >/dev/null 2>&1
    echo "ssh: $(systemctl is-enabled ssh 2>&1) / $(systemctl is-active ssh 2>&1)"
    systemctl enable --now qemu-guest-agent >/dev/null 2>&1
    echo "qemu-guest-agent: $(systemctl is-enabled qemu-guest-agent 2>&1) / $(systemctl is-active qemu-guest-agent 2>&1)"
    ss -ltn 2>/dev/null | grep ':22 ' || echo "NOTHING LISTENING ON 22"

    echo "--- authorize the host key ---"
    USER_NAME=$(getent passwd | awk -F: '$3 >= 1000 && $3 < 60000 {print $1; exit}')
    echo "desktop user: ${USER_NAME:-NONE}"
    if [ -n "${USER_NAME:-}" ]; then
        HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
        install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"
        touch "$HOME_DIR/.ssh/authorized_keys"
        grep -qF "$HOST_KEY" "$HOME_DIR/.ssh/authorized_keys" \
            || echo "$HOST_KEY" >> "$HOME_DIR/.ssh/authorized_keys"
        chmod 600 "$HOME_DIR/.ssh/authorized_keys"
        chown "$USER_NAME:$USER_NAME" "$HOME_DIR/.ssh/authorized_keys"
        echo "authorized_keys entries: $(wc -l < "$HOME_DIR/.ssh/authorized_keys")"
    fi

    echo "--- after ---"
    echo "ip: $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | tr '\n' ' ')"
    echo "sshd processes: $(pgrep -c sshd 2>/dev/null || echo 0)"
    echo "DONE"
} > "$OUT" 2>&1

echo
echo "TAMAM — rapor host'ta: <repo>/.vm/bootstrap-report.txt"
grep -E "update rc|install rc|^ssh:|qemu-guest-agent:|desktop user|authorized_keys|NOTHING LISTENING|^ip:|DONE" "$OUT" | tail -10
