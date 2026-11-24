/**
 * Asterisk Console — schema single source of truth.
 *
 * Every data-bearing module is declared once here: column definitions, form
 * fields, list columns and validation. The API, the database DDL, the config
 * generators and the React UI all derive from this object, so a module can
 * never drift between backend and frontend.
 *
 * Field types: text | number | email | password | select | toggle | textarea |
 *              tags | json | time | datetime
 */

export const NAV_GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
      { key: 'calls', label: 'Call Activity', icon: 'PhoneCall' },
      { key: 'tools', label: 'Config & Dialplan', icon: 'Terminal' }
    ]
  },
  {
    id: 'connectivity',
    label: 'Connectivity',
    items: [
      { entity: 'extensions', label: 'Extensions', icon: 'UserRound' },
      { entity: 'trunks', label: 'Trunks', icon: 'Cable' },
      { entity: 'dids', label: 'DIDs', icon: 'Hash' },
      { entity: 'inbound_routes', label: 'Inbound Routes', icon: 'LogIn' },
      { entity: 'outbound_routes', label: 'Outbound Routes', icon: 'LogOut' },
      { entity: 'dahdi', label: 'DAHDI Channels', icon: 'CircuitBoard' },
      { entity: 'sms', label: 'SMS', icon: 'MessageSquare' }
    ]
  },
  {
    id: 'applications',
    label: 'Applications',
    items: [
      { entity: 'ring_groups', label: 'Ring Groups', icon: 'Users' },
      { entity: 'queues', label: 'Queues', icon: 'ListOrdered' },
      { entity: 'ivrs', label: 'IVR', icon: 'GitBranch' },
      { entity: 'time_conditions', label: 'Time Conditions', icon: 'Clock' },
      { entity: 'time_groups', label: 'Time Groups', icon: 'CalendarClock' },
      { entity: 'announcements', label: 'Announcements', icon: 'Megaphone' },
      { entity: 'conferences', label: 'Conferences', icon: 'Podcast' },
      { entity: 'paging', label: 'Paging', icon: 'Radio' },
      { entity: 'voicemail', label: 'Voicemail', icon: 'Voicemail' },
      { entity: 'parking', label: 'Parking', icon: 'SquareParking' },
      { entity: 'disa', label: 'DISA', icon: 'KeyRound' },
      { entity: 'misc_destinations', label: 'Misc Destinations', icon: 'Shuffle' }
    ]
  },
  {
    id: 'reports',
    label: 'Reports',
    items: [
      { key: 'cdr', label: 'Call Detail Records', icon: 'Table2' },
      { entity: 'recordings', label: 'Recordings', icon: 'Disc3' },
      { key: 'audit', label: 'Audit Log', icon: 'ScrollText' },
      { key: 'system', label: 'System Status', icon: 'Activity' }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { entity: 'feature_codes', label: 'Feature Codes', icon: 'Asterisk' },
      { entity: 'blacklist', label: 'Blacklist', icon: 'Ban' },
      { entity: 'allowlist', label: 'Allowlist', icon: 'ShieldCheck' },
      { entity: 'contacts', label: 'Contacts', icon: 'Contact' },
      { entity: 'music', label: 'Music on Hold', icon: 'Music4' },
      { entity: 'users', label: 'Admin Users', icon: 'UserCog' },
      { key: 'settings', label: 'Advanced Settings', icon: 'Settings2' },
      { key: 'tokens', label: 'API Tokens', icon: 'KeySquare' },
      { key: 'modules', label: 'Module Registry', icon: 'Boxes' }
    ]
  }
];

const DEST_TYPES = [
  ['extension', 'Extension'],
  ['ring_group', 'Ring Group'],
  ['queue', 'Queue'],
  ['ivr', 'IVR'],
  ['time_condition', 'Time Condition'],
  ['announcement', 'Announcement'],
  ['voicemail', 'Voicemail'],
  ['conference', 'Conference'],
  ['parking', 'Parking Lot'],
  ['disa', 'DISA'],
  ['misc', 'Misc Destination'],
  ['terminate', 'Terminate Call']
];

const destFields = (prefix = 'destination') => [
  {
    key: `${prefix}_type`,
    label: 'Destination type',
    type: 'select',
    options: DEST_TYPES,
    default: 'extension'
  },
  { key: `${prefix}`, label: 'Destination', type: 'destination', help: 'Target selected by type above' }
];

/** True when an entity's rows are compiled into Asterisk configuration files. */
export const ENTITIES = {
  extensions: {
    label: 'Extension',
    plural: 'Extensions',
    icon: 'UserRound',
    searchable: ['extension', 'name', 'email'],
    order: 'extension',
    configFile: 'pjsip.conf',
    fields: [
      { key: 'extension', label: 'Extension', type: 'number', required: true, unique: true, list: true, width: 110 },
      { key: 'name', label: 'Display name', type: 'text', required: true, list: true },
      { key: 'email', label: 'Email', type: 'email', list: true },
      { key: 'callerid', label: 'Outbound CID', type: 'text', help: 'e.g. "Front Desk" <5551234>' },
      { key: 'tech', label: 'Technology', type: 'select', options: [['pjsip', 'PJSIP'], ['sip', 'SIP (chan_sip)'], ['iax2', 'IAX2']], default: 'pjsip', list: true, width: 100 },
      { key: 'secret', label: 'Secret', type: 'password', help: 'Generated automatically when left blank' },
      { key: 'voicemail', label: 'Voicemail + VMX', type: 'toggle', default: true, list: true },
      { key: 'vm_pin', label: 'Voicemail PIN', type: 'password', help: '4–8 digits' },
      { key: 'vm_email', label: 'Voicemail email', type: 'email' },
      { key: 'context', label: 'Context', type: 'text', default: 'from-internal' },
      { key: 'codecs', label: 'Codecs', type: 'tags', default: 'ulaw,alaw', help: 'Comma separated, priority order' },
      { key: 'max_contacts', label: 'Max contacts', type: 'number', default: 3 },
      { key: 'recording', label: 'Call recording', type: 'select', options: [['never', 'Never'], ['always', 'Always'], ['inbound', 'Inbound only'], ['outbound', 'Outbound only']], default: 'never' },
      { key: 'ring_time', label: 'Ring time (s)', type: 'number', default: 20 },
      { key: 'outbound_cid', label: 'Outbound caller ID number', type: 'text' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },

  trunks: {
    label: 'Trunk',
    plural: 'Trunks',
    icon: 'Cable',
    searchable: ['name', 'host', 'username'],
    order: 'name',
    configFile: 'pjsip.conf',
    fields: [
      { key: 'name', label: 'Trunk name', type: 'text', required: true, unique: true, list: true },
      { key: 'tech', label: 'Technology', type: 'select', options: [['pjsip', 'PJSIP'], ['sip', 'SIP (chan_sip)'], ['iax2', 'IAX2']], default: 'pjsip', list: true, width: 100 },
      { key: 'host', label: 'Host / SIP server', type: 'text', required: true, list: true },
      { key: 'port', label: 'Port', type: 'number', default: 5060, width: 90 },
      { key: 'username', label: 'Username', type: 'text', list: true },
      { key: 'secret', label: 'Secret', type: 'password' },
      { key: 'auth', label: 'Authentication', type: 'select', options: [['outbound', 'Outbound'], ['inbound', 'Inbound'], ['both', 'Both']], default: 'both', list: true, width: 110 },
      { key: 'registration', label: 'Send registration', type: 'toggle', default: true },
      { key: 'from_user', label: 'From user', type: 'text' },
      { key: 'from_domain', label: 'From domain', type: 'text' },
      { key: 'context', label: 'Context', type: 'text', default: 'from-trunk' },
      { key: 'codecs', label: 'Codecs', type: 'tags', default: 'ulaw,alaw' },
      { key: 'cid_prefix', label: 'CID prefix', type: 'text' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  dids: {
    label: 'DID',
    plural: 'DIDs',
    icon: 'Hash',
    searchable: ['number', 'description', 'carrier'],
    order: 'number',
    fields: [
      { key: 'number', label: 'DID number', type: 'text', required: true, unique: true, list: true },
      { key: 'description', label: 'Description', type: 'text', list: true },
      { key: 'carrier', label: 'Carrier / trunk', type: 'text', list: true },
      { key: 'country', label: 'Country', type: 'text', default: 'US' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  inbound_routes: {
    label: 'Inbound Route',
    plural: 'Inbound Routes',
    icon: 'LogIn',
    searchable: ['did', 'cid', 'description'],
    order: 'did',
    fields: [
      { key: 'description', label: 'Description', type: 'text', list: true },
      { key: 'did', label: 'DID number', type: 'text', required: true, list: true, help: 'Match an exact number or a pattern like _1NXXNXXXXXX' },
      { key: 'cid', label: 'Caller ID number', type: 'text', help: 'Optional: only match calls from this caller ID' },
      ...destFields('destination'),
      { key: 'privacy', label: 'Privacy manager', type: 'select', options: [['no', 'No'], ['yes', 'Require caller ID']], default: 'no' },
      { key: 'fax', label: 'Detect fax', type: 'toggle', default: false },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  outbound_routes: {
    label: 'Outbound Route',
    plural: 'Outbound Routes',
    icon: 'LogOut',
    searchable: ['name', 'patterns'],
    order: 'name',
    configFile: 'extensions.conf',
    fields: [
      { key: 'name', label: 'Route name', type: 'text', required: true, list: true },
      { key: 'patterns', label: 'Dial patterns', type: 'tags', required: true, list: true, help: 'One per line: matches are evaluated in order, e.g. 1NXXNXXXXXX or 911' },
      { key: 'trunks', label: 'Trunk sequence', type: 'tags', required: true, list: true, help: 'Ordered trunk names; first available wins' },
      { key: 'prepend', label: 'Prepend digits', type: 'text' },
      { key: 'prefix', label: 'Strip prefix', type: 'text' },
      { key: 'callerid', label: 'Override caller ID', type: 'text' },
      { key: 'emergency', label: 'Emergency route', type: 'toggle', default: false, list: true },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  ring_groups: {
    label: 'Ring Group',
    plural: 'Ring Groups',
    icon: 'Users',
    searchable: ['name', 'number'],
    order: 'number',
    fields: [
      { key: 'number', label: 'Ring group number', type: 'number', required: true, unique: true, list: true, width: 130 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'strategy', label: 'Ring strategy', type: 'select', options: [['ringall', 'Ring all'], ['hunt', 'Hunt'], ['memoryhunt', 'Memory hunt'], ['random', 'Random']], default: 'ringall', list: true },
      { key: 'ring_time', label: 'Ring time (s)', type: 'number', default: 20 },
      { key: 'members', label: 'Members', type: 'tags', required: true, list: true, help: 'Extension numbers, comma separated' },
      { key: 'cid_name', label: 'Group description sent to callee', type: 'text' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  queues: {
    label: 'Queue',
    plural: 'Queues',
    icon: 'ListOrdered',
    searchable: ['name', 'number'],
    order: 'number',
    configFile: 'queues.conf',
    fields: [
      { key: 'number', label: 'Queue number', type: 'number', required: true, unique: true, list: true, width: 120 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'strategy', label: 'Strategy', type: 'select', options: [['ringall', 'Ring all'], ['leastrecent', 'Least recent'], ['fewestcalls', 'Fewest calls'], ['random', 'Random'], ['rrmemory', 'Round robin (memory)'], ['linear', 'Linear'], ['wrandom', 'Weighted random']], default: 'ringall', list: true },
      { key: 'timeout', label: 'Agent timeout (s)', type: 'number', default: 15 },
      { key: 'retry', label: 'Retry (s)', type: 'number', default: 5 },
      { key: 'maxlen', label: 'Max waiting callers', type: 'number', default: 0, help: '0 = unlimited' },
      { key: 'weight', label: 'Weight', type: 'number', default: 0 },
      { key: 'joinempty', label: 'Join when empty', type: 'select', options: [['yes', 'Yes'], ['no', 'No'], ['strict', 'Strict']], default: 'yes' },
      { key: 'leavewhenempty', label: 'Leave when empty', type: 'select', options: [['no', 'No'], ['yes', 'Yes'], ['strict', 'Strict']], default: 'no' },
      { key: 'agents', label: 'Static agents', type: 'tags', list: true, help: 'Extension numbers, comma separated' },
      { key: 'music', label: 'Music on hold class', type: 'text', default: 'default' },
      { key: 'announcement', label: 'Announcement recording', type: 'text' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  ivrs: {
    label: 'IVR',
    plural: 'IVR Menus',
    icon: 'GitBranch',
    searchable: ['name', 'number'],
    order: 'number',
    fields: [
      { key: 'number', label: 'IVR number', type: 'number', required: true, unique: true, list: true, width: 120 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'greeting', label: 'Greeting recording', type: 'text', help: 'Recording name, played before the menu' },
      { key: 'repeat_loops', label: 'Repeat loops', type: 'number', default: 3 },
      { key: 'timeout', label: 'Input timeout (s)', type: 'number', default: 10 },
      { key: 'options', label: 'Menu entries', type: 'json', list: true, help: '[{"key":"1","type":"extension","target":"1001"}]' },
      ...destFields('invalid_destination'),
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  time_conditions: {
    label: 'Time Condition',
    plural: 'Time Conditions',
    icon: 'Clock',
    searchable: ['name', 'number'],
    order: 'number',
    fields: [
      { key: 'number', label: 'Feature code', type: 'number', required: true, unique: true, list: true, width: 120 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'time_group', label: 'Time group', type: 'relation', relation: 'time_groups', list: true },
      { key: 'match_type', label: 'Match', type: 'select', options: [['all', 'All conditions'], ['any', 'Any condition']], default: 'all' },
      ...destFields('true_destination'),
      ...destFields('false_destination'),
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  time_groups: {
    label: 'Time Group',
    plural: 'Time Groups',
    icon: 'CalendarClock',
    searchable: ['name'],
    order: 'name',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'ranges', label: 'Time ranges', type: 'json', list: true, help: '[{"days":"mon-fri","start":"09:00","end":"17:00"}]' },
      { key: 'timezone', label: 'Timezone', type: 'text', default: 'system' }
    ]
  },

  announcements: {
    label: 'Announcement',
    plural: 'Announcements',
    icon: 'Megaphone',
    searchable: ['name', 'number'],
    order: 'number',
    fields: [
      { key: 'number', label: 'Feature code', type: 'number', required: true, unique: true, list: true, width: 120 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'recording', label: 'Recording', type: 'text', required: true, list: true },
      { key: 'return_after', label: 'Return to caller after playback', type: 'toggle', default: false },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  conferences: {
    label: 'Conference',
    plural: 'Conferences',
    icon: 'Podcast',
    searchable: ['name', 'number'],
    order: 'number',
    fields: [
      { key: 'number', label: 'Conference number', type: 'number', required: true, unique: true, list: true, width: 130 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'pin', label: 'User PIN', type: 'password' },
      { key: 'admin_pin', label: 'Admin PIN', type: 'password' },
      { key: 'max_members', label: 'Max members', type: 'number', default: 0, help: '0 = unlimited' },
      { key: 'wait_for_leader', label: 'Wait for leader', type: 'toggle', default: false },
      { key: 'mute_on_join', label: 'Mute on join', type: 'toggle', default: false },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  paging: {
    label: 'Paging Group',
    plural: 'Paging',
    icon: 'Radio',
    searchable: ['name', 'number'],
    order: 'number',
    fields: [
      { key: 'number', label: 'Paging code', type: 'number', required: true, unique: true, list: true, width: 120 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'members', label: 'Devices', type: 'tags', required: true, list: true, help: 'Extension numbers dialled with auto-answer' },
      { key: 'duplex', label: 'Duplex', type: 'toggle', default: false },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  voicemail: {
    label: 'Voicemail Box',
    plural: 'Voicemail',
    icon: 'Voicemail',
    searchable: ['mailbox', 'name', 'email'],
    order: 'mailbox',
    configFile: 'voicemail.conf',
    fields: [
      { key: 'mailbox', label: 'Mailbox', type: 'number', required: true, unique: true, list: true, width: 110 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'pin', label: 'PIN', type: 'password' },
      { key: 'email', label: 'Email', type: 'email', list: true },
      { key: 'context', label: 'Context', type: 'text', default: 'default' },
      { key: 'attach', label: 'Attach recording to email', type: 'toggle', default: true },
      { key: 'delete_after_email', label: 'Delete after email', type: 'toggle', default: false },
      { key: 'max_messages', label: 'Max messages', type: 'number', default: 100 },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  parking: {
    label: 'Parking Lot',
    plural: 'Parking',
    icon: 'SquareParking',
    searchable: ['name', 'number'],
    order: 'number',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'number', label: 'Parking extension', type: 'number', required: true, unique: true, list: true, width: 140 },
      { key: 'slots', label: 'Slots', type: 'number', default: 8 },
      { key: 'timeout', label: 'Timeout (s)', type: 'number', default: 45 },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  disa: {
    label: 'DISA',
    plural: 'DISA',
    icon: 'KeyRound',
    searchable: ['name', 'number'],
    order: 'number',
    fields: [
      { key: 'number', label: 'DISA number', type: 'number', required: true, unique: true, list: true, width: 130 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'pin', label: 'PIN', type: 'password' },
      { key: 'context', label: 'Context', type: 'text', default: 'from-internal' },
      { key: 'callerid', label: 'Caller ID', type: 'text' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  misc_destinations: {
    label: 'Misc Destination',
    plural: 'Misc Destinations',
    icon: 'Shuffle',
    searchable: ['name', 'number'],
    order: 'number',
    fields: [
      { key: 'number', label: 'Destination code', type: 'number', required: true, unique: true, list: true, width: 150 },
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'context', label: 'Target context', type: 'text', required: true },
      { key: 'extension', label: 'Target extension', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  feature_codes: {
    label: 'Feature Code',
    plural: 'Feature Codes',
    icon: 'Asterisk',
    searchable: ['feature', 'code'],
    order: 'feature',
    configFile: 'features.conf',
    fields: [
      { key: 'feature', label: 'Feature', type: 'select', options: [['call_parking', 'Call parking'], ['parking_announce', 'Parking announcement'], ['blind_transfer', 'Blind transfer'], ['attended_transfer', 'Attended transfer'], ['pickup', 'Call pickup'], ['automon', 'One-touch monitor'], ['disconnect', 'Disconnect'], ['voicemail', 'Voicemail access']], default: 'pickup', list: true },
      { key: 'code', label: 'Code', type: 'text', required: true, list: true, width: 110 },
      { key: 'description', label: 'Description', type: 'text', list: true },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  blacklist: {
    label: 'Blacklist Entry',
    plural: 'Blacklist',
    icon: 'Ban',
    searchable: ['number', 'description'],
    order: 'number',
    fields: [
      { key: 'number', label: 'Number / pattern', type: 'text', required: true, unique: true, list: true },
      { key: 'description', label: 'Reason', type: 'text', list: true },
      { key: 'enabled', label: 'Blocked', type: 'toggle', default: true, list: true }
    ]
  },

  allowlist: {
    label: 'Allowlist Entry',
    plural: 'Allowlist',
    icon: 'ShieldCheck',
    searchable: ['number', 'description'],
    order: 'number',
    fields: [
      { key: 'number', label: 'Number / pattern', type: 'text', required: true, unique: true, list: true },
      { key: 'description', label: 'Reason', type: 'text', list: true },
      { key: 'enabled', label: 'Bypasses blacklist', type: 'toggle', default: true, list: true }
    ]
  },

  contacts: {
    label: 'Contact',
    plural: 'Contacts',
    icon: 'Contact',
    searchable: ['first_name', 'last_name', 'company', 'number', 'email'],
    order: 'last_name',
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', list: true },
      { key: 'last_name', label: 'Last name', type: 'text', required: true, list: true },
      { key: 'company', label: 'Company', type: 'text', list: true },
      { key: 'number', label: 'Phone', type: 'text', list: true },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'type', label: 'Type', type: 'select', options: [['internal', 'Internal'], ['external', 'External'], ['vendor', 'Vendor'], ['emergency', 'Emergency']], default: 'external', list: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },

  music: {
    label: 'Music Class',
    plural: 'Music on Hold',
    icon: 'Music4',
    ai: 'jingle',
    searchable: ['name', 'path'],
    order: 'name',
    fields: [
      { key: 'name', label: 'Class name', type: 'text', required: true, unique: true, list: true },
      { key: 'mode', label: 'Mode', type: 'select', options: [['files', 'Files'], ['playlist', 'Playlist'], ['random', 'Random']], default: 'files', list: true },
      { key: 'path', label: 'Directory', type: 'text', default: '/var/lib/asterisk/moh' },
      { key: 'sort', label: 'Sort order', type: 'select', options: [['alpha', 'Alphabetical'], ['rand', 'Random']], default: 'alpha' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  recordings: {
    label: 'Recording',
    plural: 'Recordings',
    icon: 'Disc3',
    ai: 'recording',
    searchable: ['name', 'filename'],
    order: 'name',
    fields: [
      { key: 'name', label: 'Recording name', type: 'text', required: true, unique: true, list: true },
      { key: 'filename', label: 'File', type: 'text', list: true, help: 'Path under the Asterisk sounds directory' },
      { key: 'language', label: 'Language', type: 'text', default: 'en' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  dahdi: {
    label: 'DAHDI Channel',
    plural: 'DAHDI Channels',
    icon: 'CircuitBoard',
    searchable: ['channel', 'description'],
    order: 'channel',
    fields: [
      { key: 'channel', label: 'Channel', type: 'number', required: true, unique: true, list: true },
      { key: 'signalling', label: 'Signalling', type: 'select', options: [['fxo_ks', 'FXO Kewlstart'], ['fxs_ks', 'FXS Kewlstart'], ['pri_net', 'PRI NET'], ['pri_cpe', 'PRI CPE']], default: 'fxo_ks', list: true },
      { key: 'context', label: 'Context', type: 'text', default: 'from-pstn' },
      { key: 'group', label: 'Group', type: 'number', default: 0 },
      { key: 'description', label: 'Description', type: 'text', list: true },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  sms: {
    label: 'SMS Route',
    plural: 'SMS',
    icon: 'MessageSquare',
    searchable: ['number', 'destination'],
    order: 'number',
    fields: [
      { key: 'number', label: 'SMS number', type: 'text', required: true, unique: true, list: true },
      { key: 'destination', label: 'Deliver to extension', type: 'text', required: true, list: true },
      { key: 'trunk', label: 'Trunk', type: 'text' },
      { key: 'email_forward', label: 'Forward by email', type: 'toggle', default: false },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  users: {
    label: 'Admin User',
    plural: 'Admin Users',
    icon: 'UserCog',
    searchable: ['username', 'name', 'email'],
    order: 'username',
    system: true,
    fields: [
      { key: 'username', label: 'Username', type: 'text', required: true, unique: true, list: true },
      { key: 'name', label: 'Full name', type: 'text', list: true },
      { key: 'email', label: 'Email', type: 'email', list: true },
      { key: 'role', label: 'Role', type: 'select', options: [['admin', 'Administrator'], ['operator', 'Operator'], ['readonly', 'Read only']], default: 'operator', list: true },
      { key: 'password', label: 'Password', type: 'password', help: 'Leave blank to keep the current password' },
      { key: 'enabled', label: 'Enabled', type: 'toggle', default: true, list: true }
    ]
  },

  api_keys: {
    label: 'API Token',
    plural: 'API Tokens',
    icon: 'KeySquare',
    searchable: ['name', 'prefix'],
    order: 'name',
    system: true,
    fields: [
      { key: 'name', label: 'Token name', type: 'text', required: true, list: true },
      { key: 'role', label: 'Scope', type: 'select', options: [['readonly', 'Read only'], ['operator', 'Operator'], ['admin', 'Administrator']], default: 'readonly', list: true },
      { key: 'prefix', label: 'Prefix', type: 'text' },
      { key: 'last_used', label: 'Last used', type: 'text', list: true }
    ]
  }
};

/** Settings surfaced on the Advanced Settings page, grouped by section. */
export const SETTINGS_GROUPS = [
  {
    group: 'General',
    items: [
      { key: 'pbx_name', label: 'System name', type: 'text', default: 'Asterisk Console' },
      { key: 'pbx_language', label: 'Default language', type: 'select', options: [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']], default: 'en' },
      { key: 'pbx_timezone', label: 'Timezone', type: 'text', default: 'UTC' },
      { key: 'record_all_calls', label: 'Record all calls', type: 'toggle', default: false }
    ]
  },
  {
    group: 'Asterisk',
    items: [
      { key: 'ami_host', label: 'AMI host', type: 'text', default: '' },
      { key: 'ami_port', label: 'AMI port', type: 'number', default: 5038 },
      { key: 'ami_user', label: 'AMI user', type: 'text', default: '' },
      { key: 'ami_secret', label: 'AMI secret', type: 'password', default: '' },
      { key: 'ast_config_dir', label: 'Config output directory', type: 'text', default: '/etc/asterisk' }
    ]
  },
  {
    group: 'Security',
    items: [
      { key: 'login_max_attempts', label: 'Max login attempts', type: 'number', default: 8 },
      { key: 'require_strong_pins', label: 'Require strong voicemail PINs', type: 'toggle', default: true },
      { key: 'block_anonymous', label: 'Block anonymous inbound calls', type: 'toggle', default: false }
    ]
  }
];

/**
 * The 84 modules observed in the live FreePBX 17 navigation, mapped onto this
 * application's consolidated capabilities. `entity` points at the table that
 * now owns the module's data; `replaces` documents the consolidation.
 */
export const MODULES = [
  // Admin
  ['ampusers', 'Admin Users', 'Admin', 'users'],
  ['userman', 'User Management', 'Admin', 'users'],
  ['allowlist', 'Allowlist', 'Admin', 'allowlist'],
  ['blacklist', 'Blacklist', 'Admin', 'blacklist'],
  ['cli', 'Asterisk CLI', 'Admin', null],
  ['astmodules', 'Asterisk Modules', 'Admin', null],
  ['backup', 'Backup & Restore', 'Admin', null],
  ['bulkhandler', 'Bulk Handler (CSV)', 'Admin', 'extensions'],
  ['superfecta', 'Superfecta (CID lookup)', 'Admin', null],
  ['cidlookup', 'CID Lookup', 'Admin', 'contacts'],
  ['certman', 'Certificate Manager', 'Admin', null],
  ['configedit', 'Config Edit', 'Admin', null],
  ['contactmanager', 'Contact Manager', 'Admin', 'contacts'],
  ['customdests', 'Custom Destinations', 'Admin', 'misc_destinations'],
  ['customextens', 'Custom Extensions', 'Admin', 'extensions'],
  ['featurecodeadmin', 'Feature Code Admin', 'Admin', 'feature_codes'],
  ['modules', 'Module Admin', 'Admin', null],
  ['outcnam', 'Outbound CNAM', 'Admin', null],
  ['presencestate', 'Presence State', 'Admin', null],
  ['soundlang', 'Sound Language', 'Admin', 'recordings'],
  ['synologyabb', 'Synology Backup', 'Admin', null],
  ['recordings', 'Recordings', 'Admin', 'recordings'],
  ['updates', 'Updates', 'Admin', null],
  // Applications
  ['amd', 'Answering Machine Detection', 'Applications', null],
  ['announcement', 'Announcements', 'Applications', 'announcements'],
  ['calendar', 'Calendar', 'Applications', null],
  ['calendargroups', 'Calendar Groups', 'Applications', null],
  ['daynight', 'Day / Night', 'Applications', 'time_conditions'],
  ['callrecording', 'Call Recording', 'Applications', 'recordings'],
  ['callback', 'Callback', 'Applications', null],
  ['conferences', 'Conferences', 'Applications', 'conferences'],
  ['disa', 'DISA', 'Applications', 'disa'],
  ['directory', 'Directory', 'Applications', 'contacts'],
  ['dynroute', 'Dynamic Routes', 'Applications', null],
  ['findmefollow', 'Follow Me', 'Applications', 'extensions'],
  ['ivr', 'IVR', 'Applications', 'ivrs'],
  ['languages', 'Languages', 'Applications', null],
  ['miscapps', 'Misc Applications', 'Applications', 'misc_destinations'],
  ['miscdests', 'Misc Destinations', 'Applications', 'misc_destinations'],
  ['missedcall', 'Missed Call Notify', 'Applications', null],
  ['paging', 'Paging', 'Applications', 'paging'],
  ['parking', 'Parking', 'Applications', 'parking'],
  ['queueprio', 'Queue Priorities', 'Applications', 'queues'],
  ['queues', 'Queues', 'Applications', 'queues'],
  ['ringgroups', 'Ring Groups', 'Applications', 'ring_groups'],
  ['setcid', 'Set Caller ID', 'Applications', null],
  ['tts', 'Text to Speech', 'Applications', null],
  ['timeconditions', 'Time Conditions', 'Applications', 'time_conditions'],
  ['timegroups', 'Time Groups', 'Applications', 'time_groups'],
  ['vmblast', 'Voicemail Blast', 'Applications', 'voicemail'],
  ['hotelwakeup', 'Hotel Wakeup', 'Applications', null],
  // Connectivity
  ['api', 'API', 'Connectivity', 'api_keys'],
  ['customcontexts', 'Custom Contexts', 'Connectivity', null],
  ['customcontextsadmin', 'Custom Contexts Admin', 'Connectivity', null],
  ['dahdichandids', 'DAHDI Channel DIDs', 'Connectivity', 'dahdi'],
  ['dahdi', 'DAHDI Config', 'Connectivity', 'dahdi'],
  ['extensions', 'Extensions', 'Connectivity', 'extensions'],
  ['did', 'Inbound Routes', 'Connectivity', 'inbound_routes'],
  ['routing', 'Outbound Routes', 'Connectivity', 'outbound_routes'],
  ['sms', 'SMS', 'Connectivity', 'sms'],
  ['trunks', 'Trunks', 'Connectivity', 'trunks'],
  ['index', 'Dashboard', 'Connectivity', null],
  // Reports
  ['asteriskinfo', 'Asterisk Info', 'Reports', null],
  ['cdr', 'Call Detail Records', 'Reports', null],
  ['cel', 'Call Event Log', 'Reports', null],
  ['phpinfo', 'PHP Info', 'Reports', null],
  ['printextensions', 'Print Extensions', 'Reports', 'extensions'],
  ['logfiles', 'Log Files', 'Reports', null],
  ['weakpasswords', 'Weak Passwords', 'Reports', 'extensions'],
  // Settings
  ['advancedsettings', 'Advanced Settings', 'Settings', null],
  ['iaxsettings', 'IAX Settings', 'Settings', null],
  ['logfiles_settings', 'Logfile Settings', 'Settings', null],
  ['manager', 'Asterisk Manager', 'Settings', null],
  ['arimanager', 'ARI Manager', 'Settings', null],
  ['sipsettings', 'SIP Settings', 'Settings', null],
  ['extensionsettings', 'Extension Settings', 'Settings', null],
  ['fax', 'Fax Configuration', 'Settings', null],
  ['filestore', 'File Store', 'Settings', null],
  ['music', 'Music on Hold', 'Settings', 'music'],
  ['pinsets', 'PIN Sets', 'Settings', null],
  ['outroutemsg', 'Outbound Route Messages', 'Settings', 'outbound_routes'],
  ['ttsengines', 'TTS Engines', 'Settings', null],
  ['voicemail', 'Voicemail Admin', 'Settings', 'voicemail'],
  ['hotelwakeup_settings', 'Hotel Wakeup Settings', 'Settings', null]
].map(([id, label, group, entity]) => ({ id, label, group, entity }));

export const FIELD_TYPES = new Set([
  'text', 'number', 'email', 'password', 'select', 'toggle',
  'textarea', 'tags', 'json', 'time', 'datetime', 'relation', 'destination'
]);

/** Fields the client may never receive (secrets are write-only). */
export const SECRET_TYPES = new Set(['password']);

export function entityColumns(entity) {
  const out = [];
  for (const f of entity.fields) {
    if (f.key === 'password') continue;
    out.push({ key: f.key, type: f.type });
  }
  return out;
}
