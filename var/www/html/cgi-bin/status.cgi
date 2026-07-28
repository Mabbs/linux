#!/bin/sh
# CGI script: Linux system info in JSON (with network interfaces and traffic)

# --- hostname and kernel (single uname call) ---
read -r KERNEL_NAME HOSTNAME KERNEL_RELEASE MACHINE <<EOF
$(uname -s -n -r -m)
EOF

# --- uptime ---
UPTIME_SEC=0
UPTIME_STR="unknown"
if [ -r /proc/uptime ]; then
    read -r UP _ < /proc/uptime
    UPTIME_SEC=${UP%.*}
    days=$(( UPTIME_SEC / 86400 ))
    hours=$(( (UPTIME_SEC % 86400) / 3600 ))
    mins=$(( (UPTIME_SEC % 3600) / 60 ))
    UPTIME_STR="${days}d ${hours}h ${mins}m"
fi

CPU_CORES=$(grep -c "^processor" /proc/cpuinfo)

# --- load averages ---
LOAD1=0; LOAD5=0; LOAD15=0
if [ -r /proc/loadavg ]; then
    read -r LOAD1 LOAD5 LOAD15 _ < /proc/loadavg
fi

# --- memory info: single awk pass instead of five ---
MEM_TOTAL=0; MEM_FREE=0; MEM_AVAIL=0; SWAP_TOTAL=0; SWAP_FREE=0
if [ -r /proc/meminfo ]; then
    eval "$(awk '
        /^MemTotal:/     { printf "MEM_TOTAL=%d\n", $2 }
        /^MemFree:/      { printf "MEM_FREE=%d\n", $2 }
        /^MemAvailable:/ { printf "MEM_AVAIL=%d\n", $2 }
        /^SwapTotal:/    { printf "SWAP_TOTAL=%d\n", $2 }
        /^SwapFree:/     { printf "SWAP_FREE=%d\n", $2 }
    ' /proc/meminfo)"
fi

# --- network interfaces (with TX/RX bytes) ---
NET_JSON=""
if command -v ip >/dev/null 2>&1 && [ -d /sys/class/net ]; then
    NET_JSON=$(
        {
            for iface in /sys/class/net/*; do
                [ -d "$iface" ] || continue
                name=${iface##*/}
                mac=""; state=""; rx=0; tx=0
                [ -r "$iface/address" ] && read -r mac < "$iface/address"
                [ -r "$iface/operstate" ] && read -r state < "$iface/operstate"
                [ -r "$iface/statistics/rx_bytes" ] && read -r rx < "$iface/statistics/rx_bytes"
                [ -r "$iface/statistics/tx_bytes" ] && read -r tx < "$iface/statistics/tx_bytes"
                printf '%s %s %s %s %s\n' "$name" "$mac" "$state" "$rx" "$tx"
            done
        } | awk '
        BEGIN {
            cmd = "ip -o -4 addr show"
            while ((cmd | getline) > 0) {
                iface = $2
                sub(/:$/, "", iface)
                addr = $4
                if (ip[iface])
                    ip[iface] = ip[iface] ", \"" addr "\""
                else
                    ip[iface] = "\"" addr "\""
            }
            close(cmd)
            first = 1
            printf "  \"network\": ["
        }
        {
            name = $1; mac = $2; state = $3
            rx = $4; tx = $5
            addrs = ip[name]
            if (!addrs) addrs = ""
            if (!first) printf ","
            first = 0
            printf "\n    { \"name\": \"%s\", \"mac\": \"%s\", \"state\": \"%s\", \"ipv4\": [%s], \"rx_bytes\": %s, \"tx_bytes\": %s }",
                   name, mac, state, addrs, rx, tx
        }
        END {
            printf "\n  ]\n"
        }'
    )
else
    NET_JSON="  \"network\": []"
fi

printf "Content-Type: application/json\r\n\r\n"

cat <<EOF
{
  "hostname": "${HOSTNAME}",
  "kernel": {
    "name": "${KERNEL_NAME}",
    "release": "${KERNEL_RELEASE}",
    "machine": "${MACHINE}"
  },
  "uptime": {
    "seconds": ${UPTIME_SEC},
    "human": "${UPTIME_STR}"
  },
  "cpu": {
    "cores": ${CPU_CORES}
  },
  "load_average": {
    "1min": ${LOAD1},
    "5min": ${LOAD5},
    "15min": ${LOAD15}
  },
  "memory": {
    "total_kb": ${MEM_TOTAL},
    "free_kb": ${MEM_FREE},
    "available_kb": ${MEM_AVAIL},
    "swap_total_kb": ${SWAP_TOTAL},
    "swap_free_kb": ${SWAP_FREE}
  },
  $NET_JSON
}
EOF