/* Bancada de Rede — catálogo de equipamentos.
   Portas: grupos {n, sp (velocidade), s (nome curto), f (nome completo no SO nativo), i0 (primeiro índice), role}.
   "{i}" é trocado pelo número da porta. role: "mgmt" (gerência fora de banda) ou "internal" (backplane de chassis).
   Números de portas, U e consumo são aproximados para planejamento de laboratório. */
(function (root) {
'use strict';
const CATS = [
  ['dc', 'Switches de data center (leaf / spine)'],
  ['acc', 'Switches de acesso e gerência (OOB)'],
  ['rtr', 'Roteadores (PE / borda)'],
  ['fw', 'Firewalls'],
  ['rack', 'Servidores de rack'],
  ['blade', 'Chassis blade'],
  ['cloud', 'Nuvens (Internet)'],
  ['k8s', 'Kubernetes / OpenShift']
];
const M = [
  // ---------- data center ----------
  { id: 'cisco-n9k-93180yc-fx', vendor: 'Cisco', name: 'Nexus 93180YC-FX', cat: 'dc', type: 'sw3', os: 'nxos', u: 1, w: 425, role: 'Leaf / ToR',
    ports: [{ n: 48, sp: '25G', s: 'Eth1/{i}', f: 'Ethernet1/{i}', i0: 1 }, { n: 6, sp: '100G', s: 'Eth1/{i}', f: 'Ethernet1/{i}', i0: 49 }, { n: 1, sp: '1G', s: 'mgmt0', role: 'mgmt' }] },
  { id: 'cisco-n9k-9364c', vendor: 'Cisco', name: 'Nexus 9364C', cat: 'dc', type: 'sw3', os: 'nxos', u: 2, w: 1100, role: 'Spine',
    ports: [{ n: 64, sp: '100G', s: 'Eth1/{i}', f: 'Ethernet1/{i}', i0: 1 }, { n: 1, sp: '1G', s: 'mgmt0', role: 'mgmt' }] },
  { id: 'juniper-qfx5120-48y', vendor: 'Juniper', name: 'QFX5120-48Y', cat: 'dc', type: 'sw3', os: 'junos', u: 1, w: 450, role: 'Leaf / ToR',
    ports: [{ n: 48, sp: '25G', s: 'xe-0/0/{i}', i0: 0 }, { n: 8, sp: '100G', s: 'et-0/0/{i}', i0: 48 }, { n: 1, sp: '1G', s: 'em0', role: 'mgmt' }] },
  { id: 'juniper-qfx5120-32c', vendor: 'Juniper', name: 'QFX5120-32C', cat: 'dc', type: 'sw3', os: 'junos', u: 1, w: 550, role: 'Spine',
    ports: [{ n: 32, sp: '100G', s: 'et-0/0/{i}', i0: 0 }, { n: 1, sp: '1G', s: 'em0', role: 'mgmt' }] },
  { id: 'arista-7050sx3-48yc8', vendor: 'Arista', name: '7050SX3-48YC8', cat: 'dc', type: 'sw3', os: 'eos', u: 1, w: 400, role: 'Leaf / ToR',
    ports: [{ n: 48, sp: '25G', s: 'Et{i}', f: 'Ethernet{i}', i0: 1 }, { n: 8, sp: '100G', s: 'Et{i}', f: 'Ethernet{i}', i0: 49 }, { n: 1, sp: '1G', s: 'Ma1', f: 'Management1', role: 'mgmt' }] },
  { id: 'arista-7060cx-32s', vendor: 'Arista', name: '7060CX-32S', cat: 'dc', type: 'sw3', os: 'eos', u: 1, w: 500, role: 'Spine',
    ports: [{ n: 32, sp: '100G', s: 'Et{i}', f: 'Ethernet{i}', i0: 1 }, { n: 1, sp: '1G', s: 'Ma1', f: 'Management1', role: 'mgmt' }] },
  { id: 'hpe-aruba-8325-48y8c', vendor: 'HPE Aruba', name: 'CX 8325-48Y8C', cat: 'dc', type: 'sw3', os: 'aoscx', u: 1, w: 520, role: 'Leaf / ToR',
    ports: [{ n: 48, sp: '25G', s: '1/1/{i}', i0: 1 }, { n: 8, sp: '100G', s: '1/1/{i}', i0: 49 }, { n: 1, sp: '1G', s: 'mgmt', role: 'mgmt' }] },
  { id: 'dell-s5248f-on', vendor: 'Dell', name: 'PowerSwitch S5248F-ON', cat: 'dc', type: 'sw3', os: 'os10', u: 1, w: 450, role: 'Leaf / ToR',
    ports: [{ n: 48, sp: '25G', s: 'eth1/1/{i}', f: 'ethernet1/1/{i}', i0: 1 }, { n: 6, sp: '100G', s: 'eth1/1/{i}', f: 'ethernet1/1/{i}', i0: 49 }, { n: 1, sp: '1G', s: 'mgmt1/1/1', role: 'mgmt' }] },
  { id: 'dell-z9264f-on', vendor: 'Dell', name: 'PowerSwitch Z9264F-ON', cat: 'dc', type: 'sw3', os: 'os10', u: 2, w: 1000, role: 'Spine',
    ports: [{ n: 64, sp: '100G', s: 'eth1/1/{i}', f: 'ethernet1/1/{i}', i0: 1 }, { n: 1, sp: '1G', s: 'mgmt1/1/1', role: 'mgmt' }] },
  { id: 'huawei-ce6881-48s6cq', vendor: 'Huawei', name: 'CloudEngine 6881-48S6CQ', cat: 'dc', type: 'sw3', os: 'huawei', u: 1, w: 400, role: 'Leaf / ToR',
    ports: [{ n: 48, sp: '10G', s: '10GE1/0/{i}', i0: 1 }, { n: 6, sp: '100G', s: '100GE1/0/{i}', i0: 1 }, { n: 1, sp: '1G', s: 'MEth0/0/0', role: 'mgmt' }] },
  // ---------- acesso / OOB ----------
  { id: 'cisco-c9300-48p', vendor: 'Cisco', name: 'Catalyst 9300-48P', cat: 'acc', type: 'sw3', os: 'cisco', u: 1, w: 450, role: 'Acesso / OOB',
    ports: [{ n: 48, sp: '1G', s: 'Gi1/0/{i}', f: 'GigabitEthernet1/0/{i}', i0: 1 }, { n: 4, sp: '10G', s: 'Te1/1/{i}', f: 'TenGigabitEthernet1/1/{i}', i0: 1 }, { n: 1, sp: '1G', s: 'Gi0/0', f: 'GigabitEthernet0/0', role: 'mgmt' }] },
  { id: 'cisco-c9200l-24t', vendor: 'Cisco', name: 'Catalyst 9200L-24T', cat: 'acc', type: 'sw2', os: 'cisco', u: 1, w: 125, role: 'OOB',
    ports: [{ n: 24, sp: '1G', s: 'Gi1/0/{i}', f: 'GigabitEthernet1/0/{i}', i0: 1 }, { n: 4, sp: '10G', s: 'Te1/1/{i}', f: 'TenGigabitEthernet1/1/{i}', i0: 1 }] },
  { id: 'juniper-ex4300-48t', vendor: 'Juniper', name: 'EX4300-48T', cat: 'acc', type: 'sw3', os: 'junos', u: 1, w: 350, role: 'Acesso / OOB',
    ports: [{ n: 48, sp: '1G', s: 'ge-0/0/{i}', i0: 0 }, { n: 4, sp: '10G', s: 'xe-0/2/{i}', i0: 0 }, { n: 1, sp: '1G', s: 'em0', role: 'mgmt' }] },
  { id: 'hpe-aruba-6300m-48g', vendor: 'HPE Aruba', name: 'CX 6300M 48G', cat: 'acc', type: 'sw3', os: 'aoscx', u: 1, w: 300, role: 'Acesso / OOB',
    ports: [{ n: 48, sp: '1G', s: '1/1/{i}', i0: 1 }, { n: 4, sp: '25G', s: '1/1/{i}', i0: 49 }, { n: 1, sp: '1G', s: 'mgmt', role: 'mgmt' }] },
  { id: 'dell-n3248te-on', vendor: 'Dell', name: 'PowerSwitch N3248TE-ON', cat: 'acc', type: 'sw2', os: 'os10', u: 1, w: 180, role: 'OOB',
    ports: [{ n: 48, sp: '1G', s: 'eth1/1/{i}', f: 'ethernet1/1/{i}', i0: 1 }, { n: 4, sp: '10G', s: 'eth1/1/{i}', f: 'ethernet1/1/{i}', i0: 49 }, { n: 1, sp: '1G', s: 'mgmt1/1/1', role: 'mgmt' }] },
  // ---------- roteadores ----------
  { id: 'juniper-mx204', vendor: 'Juniper', name: 'MX204', cat: 'rtr', type: 'rtr', os: 'junos', u: 1, w: 450, role: 'PE / borda',
    ports: [{ n: 4, sp: '100G', s: 'et-0/0/{i}', i0: 0 }, { n: 8, sp: '10G', s: 'xe-0/1/{i}', i0: 0 }, { n: 1, sp: '1G', s: 'fxp0', role: 'mgmt' }] },
  { id: 'cisco-asr1001-x', vendor: 'Cisco', name: 'ASR 1001-X', cat: 'rtr', type: 'rtr', os: 'cisco', u: 1, w: 400, role: 'Borda / internet',
    ports: [{ n: 6, sp: '1G', s: 'Gi0/0/{i}', f: 'GigabitEthernet0/0/{i}', i0: 0 }, { n: 2, sp: '10G', s: 'Te0/0/{i}', f: 'TenGigabitEthernet0/0/{i}', i0: 0 }, { n: 1, sp: '1G', s: 'Gi0', f: 'GigabitEthernet0', role: 'mgmt' }] },
  { id: 'arista-7280cr3-32p4', vendor: 'Arista', name: '7280CR3-32P4', cat: 'rtr', type: 'rtr', os: 'eos', u: 1, w: 650, role: 'PE / borda',
    ports: [{ n: 32, sp: '100G', s: 'Et{i}', f: 'Ethernet{i}', i0: 1 }, { n: 1, sp: '1G', s: 'Ma1', f: 'Management1', role: 'mgmt' }] },
  { id: 'huawei-ne40e-m2k', vendor: 'Huawei', name: 'NetEngine 40E-M2K', cat: 'rtr', type: 'rtr', os: 'huawei', u: 2, w: 500, role: 'PE / borda',
    ports: [{ n: 10, sp: '10G', s: 'GE0/1/{i}', f: 'GigabitEthernet0/1/{i}', i0: 0 }, { n: 2, sp: '100G', s: '100GE0/2/{i}', i0: 0 }, { n: 1, sp: '1G', s: 'GE0/0/0', f: 'GigabitEthernet0/0/0', role: 'mgmt' }] },
  { id: 'vyos-virtual', vendor: 'VyOS', name: 'Roteador virtual', cat: 'rtr', type: 'rtr', os: 'vyos', u: 0, w: 0, role: 'vRouter / VNF',
    ports: [{ n: 6, sp: '10G', s: 'eth{i}', i0: 0 }] },
  // ---------- firewalls ----------
  { id: 'fortinet-fg-600f', vendor: 'Fortinet', name: 'FortiGate 600F', cat: 'fw', type: 'fw', os: 'fortios', u: 1, w: 350, role: 'Firewall de borda',
    ports: [{ n: 16, sp: '1G', s: 'port{i}', i0: 1 }, { n: 8, sp: '25G', s: 'x{i}', i0: 1 }, { n: 1, sp: '1G', s: 'mgmt', role: 'mgmt' }] },
  { id: 'juniper-srx4100', vendor: 'Juniper', name: 'SRX4100', cat: 'fw', type: 'fw', os: 'junos', u: 1, w: 400, role: 'Firewall de borda',
    ports: [{ n: 8, sp: '10G', s: 'xe-0/0/{i}', i0: 0 }, { n: 1, sp: '1G', s: 'fxp0', role: 'mgmt' }] },
  // ---------- servidores de rack ----------
  { id: 'dell-r650', vendor: 'Dell', name: 'PowerEdge R650', cat: 'rack', type: 'srv', os: 'linux', form: 'rack', u: 1, w: 800, bmc: 'iDRAC', role: 'Compute',
    ports: [{ n: 2, sp: '1G', s: 'eno{i}', i0: 1 }, { n: 2, sp: '25G', s: 'ens1f{i}', i0: 0 }, { n: 1, sp: '1G', s: 'iDRAC', role: 'mgmt' }] },
  { id: 'dell-r750', vendor: 'Dell', name: 'PowerEdge R750', cat: 'rack', type: 'srv', os: 'linux', form: 'rack', u: 2, w: 1100, bmc: 'iDRAC', role: 'Compute / storage',
    ports: [{ n: 2, sp: '1G', s: 'eno{i}', i0: 1 }, { n: 2, sp: '25G', s: 'ens1f{i}', i0: 0 }, { n: 2, sp: '25G', s: 'ens2f{i}', i0: 0 }, { n: 1, sp: '1G', s: 'iDRAC', role: 'mgmt' }] },
  { id: 'hpe-dl360-gen11', vendor: 'HPE', name: 'ProLiant DL360 Gen11', cat: 'rack', type: 'srv', os: 'linux', form: 'rack', u: 1, w: 800, bmc: 'iLO', role: 'Controller / compute',
    ports: [{ n: 2, sp: '1G', s: 'eno{i}', i0: 1 }, { n: 2, sp: '25G', s: 'ens1f{i}', i0: 0 }, { n: 1, sp: '1G', s: 'iLO', role: 'mgmt' }] },
  { id: 'hpe-dl380-gen11', vendor: 'HPE', name: 'ProLiant DL380 Gen11', cat: 'rack', type: 'srv', os: 'linux', form: 'rack', u: 2, w: 1000, bmc: 'iLO', role: 'Compute / storage',
    ports: [{ n: 2, sp: '1G', s: 'eno{i}', i0: 1 }, { n: 2, sp: '25G', s: 'ens1f{i}', i0: 0 }, { n: 2, sp: '25G', s: 'ens2f{i}', i0: 0 }, { n: 1, sp: '1G', s: 'iLO', role: 'mgmt' }] },
  { id: 'lenovo-sr650-v3', vendor: 'Lenovo', name: 'ThinkSystem SR650 V3', cat: 'rack', type: 'srv', os: 'linux', form: 'rack', u: 2, w: 1100, bmc: 'XCC', role: 'Compute / storage',
    ports: [{ n: 2, sp: '1G', s: 'eno{i}', i0: 1 }, { n: 4, sp: '25G', s: 'ens1f{i}', i0: 0 }, { n: 1, sp: '1G', s: 'XCC', role: 'mgmt' }] },
  { id: 'supermicro-sys-120u', vendor: 'Supermicro', name: 'SYS-120U-TNR', cat: 'rack', type: 'srv', os: 'linux', form: 'rack', u: 1, w: 750, bmc: 'BMC', role: 'Compute',
    ports: [{ n: 2, sp: '10G', s: 'eno{i}', i0: 1 }, { n: 2, sp: '25G', s: 'ens1f{i}', i0: 0 }, { n: 1, sp: '1G', s: 'BMC', role: 'mgmt' }] },
  // ---------- blades (chassis e componentes) ----------
  { id: 'dell-mx7000', vendor: 'Dell', name: 'PowerEdge MX7000', cat: 'blade', type: 'chassis', u: 7, w: 3500, bays: 8, blade: 'dell-mx750c', iom: 'dell-mx9116n', ioms: ['A1', 'A2'], role: 'Chassis 8 lâminas',
    ports: [] },
  { id: 'dell-mx750c', vendor: 'Dell', name: 'PowerEdge MX750c', hidden: true, type: 'srv', os: 'linux', form: 'blade', u: 0, w: 0, bmc: 'iDRAC',
    ports: [{ n: 2, sp: '25G', s: 'ens3f{i}', i0: 0 }, { n: 1, sp: '1G', s: 'iDRAC', role: 'mgmt' }] },
  { id: 'dell-mx9116n', vendor: 'Dell', name: 'MX9116n Fabric Switching Engine', hidden: true, type: 'sw3', os: 'os10', form: 'iom', u: 0, w: 0,
    ports: [{ n: 16, sp: '25G', s: 'eth1/1/{i}', f: 'ethernet1/1/{i}', i0: 1, role: 'internal' }, { n: 8, sp: '100G', s: 'eth1/1/{i}', f: 'ethernet1/1/{i}', i0: 37 }, { n: 1, sp: '1G', s: 'mgmt1/1/1', role: 'mgmt' }] },
  { id: 'hpe-synergy-12000', vendor: 'HPE', name: 'Synergy 12000 Frame', cat: 'blade', type: 'chassis', u: 10, w: 4000, bays: 12, blade: 'hpe-sy480-gen11', iom: 'hpe-vc-se-100g', ioms: ['ICM1', 'ICM4'], role: 'Chassis 12 lâminas',
    ports: [] },
  { id: 'hpe-sy480-gen11', vendor: 'HPE', name: 'Synergy 480 Gen11', hidden: true, type: 'srv', os: 'linux', form: 'blade', u: 0, w: 0, bmc: 'iLO',
    ports: [{ n: 2, sp: '25G', s: 'ens3f{i}', i0: 0 }, { n: 1, sp: '1G', s: 'iLO', role: 'mgmt' }] },
  { id: 'hpe-vc-se-100g', vendor: 'HPE', name: 'Virtual Connect SE 100Gb F32', hidden: true, type: 'sw2', os: 'generic', form: 'iom', u: 0, w: 0,
    ports: [{ n: 12, sp: '25G', s: 'd{i}', i0: 1, role: 'internal' }, { n: 8, sp: '100G', s: 'Q{i}', i0: 1 }] },
  { id: 'cisco-ucs-5108', vendor: 'Cisco', name: 'UCS 5108 Blade Chassis', cat: 'blade', type: 'chassis', u: 6, w: 2500, bays: 8, blade: 'cisco-ucs-b200-m6', iom: 'cisco-ucs-2408', ioms: ['IOM-A', 'IOM-B'], role: 'Chassis 8 lâminas',
    ports: [] },
  { id: 'cisco-ucs-b200-m6', vendor: 'Cisco', name: 'UCS B200 M6', hidden: true, type: 'srv', os: 'linux', form: 'blade', u: 0, w: 0, bmc: 'CIMC',
    ports: [{ n: 2, sp: '25G', s: 'vnic{i}', i0: 0 }, { n: 1, sp: '1G', s: 'CIMC', role: 'mgmt' }] },
  { id: 'cisco-ucs-2408', vendor: 'Cisco', name: 'UCS 2408 IOM', hidden: true, type: 'sw2', os: 'generic', form: 'iom', u: 0, w: 0,
    ports: [{ n: 8, sp: '25G', s: 'host{i}', i0: 1, role: 'internal' }, { n: 8, sp: '25G', s: 'fabric{i}', i0: 1 }] },
  { id: 'cisco-ucs-fi-6454', vendor: 'Cisco', name: 'UCS Fabric Interconnect 6454', cat: 'blade', type: 'sw3', os: 'nxos', u: 1, w: 500, role: 'Fabric Interconnect',
    ports: [{ n: 48, sp: '25G', s: 'Eth1/{i}', f: 'Ethernet1/{i}', i0: 1 }, { n: 6, sp: '100G', s: 'Eth1/{i}', f: 'Ethernet1/{i}', i0: 49 }, { n: 1, sp: '1G', s: 'mgmt0', role: 'mgmt' }] },
  // ---------- nuvens ----------
  { id: 'cloud-internet', vendor: 'Internet', name: 'Internet real', cat: 'cloud', type: 'cloud', kind: 'real', u: 0, w: 0, role: 'Sai do lab: DNS e HTTP reais (via servidor da bancada)',
    ports: [{ n: 16, sp: '10G', s: 'wan{i}', i0: 1 }] },
  { id: 'cloud-fake', vendor: 'Internet', name: 'Internet fake (fechada)', cat: 'cloud', type: 'cloud', kind: 'fake', u: 0, w: 0, role: 'IPs públicos, DNS e sites só dentro do lab — para VPN/IPsec',
    ports: [{ n: 16, sp: '10G', s: 'wan{i}', i0: 1 }] },
  // ---------- Kubernetes / OpenShift ----------
  { id: 'k8s-kubeadm', vendor: 'Kubernetes', name: 'Cluster kubeadm v1.30', cat: 'k8s', type: 'chassis', k8s: 'kubernetes', cp: 1, workers: 3, nodeOs: 'ubuntu-22.04', u: 0, w: 0, bays: 8, blade: 'k8s-node', iom: 'k8s-fabric', ioms: ['SW'], role: '1 control-plane + 3 workers (Ubuntu 22.04, containerd)',
    ports: [] },
  { id: 'k3s-single', vendor: 'Kubernetes', name: 'k3s (nó único)', cat: 'k8s', type: 'chassis', k8s: 'k3s', cp: 1, workers: 0, nodeOs: 'ubuntu-24.04', u: 0, w: 0, bays: 4, blade: 'k8s-node', iom: 'k8s-fabric', ioms: ['SW'], role: '1 nó server (Ubuntu 24.04)',
    ports: [] },
  { id: 'ocp-4', vendor: 'Red Hat', name: 'OpenShift 4.16', cat: 'k8s', type: 'chassis', k8s: 'openshift', cp: 3, workers: 2, nodeOs: 'rhcos-4.16', u: 0, w: 0, bays: 8, blade: 'k8s-node', iom: 'k8s-fabric', ioms: ['SW'], role: '3 masters + 2 workers (RHCOS, CRI-O), VIPs de API e Ingress',
    ports: [] },
  { id: 'k8s-node', vendor: 'Kubernetes', name: 'Nó do cluster', hidden: true, type: 'srv', os: 'linux', form: 'blade', u: 0, w: 0,
    ports: [{ n: 1, sp: '25G', s: 'ens3' }] },
  { id: 'k8s-fabric', vendor: 'Kubernetes', name: 'Rede do cluster', hidden: true, type: 'sw2', os: 'generic', form: 'iom', u: 0, w: 0,
    ports: [{ n: 8, sp: '25G', s: 'node{i}', i0: 1, role: 'internal' }, { n: 4, sp: '25G', s: 'uplink{i}', i0: 1 }] }
];
const BY = {};
M.forEach(m => {
  BY[m.id] = m;
  const names = [];
  (m.ports || []).forEach(g => { for (let j = 0; j < g.n; j++) { const i = (g.i0 ?? 1) + j; const s = g.s.replace('{i}', i); names.push({ s, f: (g.f || g.s).replace('{i}', i), sp: g.sp, role: g.role || '' }); } });
  m.names = names;
  m.speeds = (m.ports || []).filter(g => g.role !== 'mgmt').map(g => `${g.n}×${g.sp}${g.role === 'internal' ? ' (internas)' : ''}`).join(' + ');
});
const C = { CATS, MODELS: M, BY };
if (typeof module !== 'undefined' && module.exports) module.exports = C; else root.BancadaCatalog = C;
})(typeof window !== 'undefined' ? window : globalThis);
