export const mock = {
  session: null as any,
  loginError: null as any,
  logoutError: null as any,
  restoreError: null as any,
  pendingRestore: false,
  resolveRestore: null as any,
  listeners: new Set<(event: string, session: any) => void>(),
  loginCalls: [] as any[],
  logoutCalls: [] as any[],
  queryCalls: [] as any[],
  membership: { home_id: 'shared-home' } as any,
  home: { id: 'shared-home', name: 'Our Cubby', created_at: '2026-09-15T00:00:00Z' } as any,
  membershipError: null as any,
  homeError: null as any,
  furniture: new Map<string, any>(),
  placedCounts: new Map<string, number>(),
  furnitureError: null as any,
  countError: null as any,
  placements: [] as any[],
  roomError: null as any,
  channels: new Set<any>(),
  creatorNames: { 'test-user': 'Ben', 'user-one': 'Ben', 'user-two': 'Girlfriend' } as Record<string, string>,
  nextId: 1,
  reset() {
    this.session = null
    this.loginError = this.logoutError = this.restoreError = null
    this.pendingRestore = false
    this.resolveRestore = null
    this.listeners.clear()
    this.loginCalls = []
    this.logoutCalls = []
    this.queryCalls = []
    this.membership = { home_id: 'shared-home' }
    this.home = { id: 'shared-home', name: 'Our Cubby', created_at: '2026-09-15T00:00:00Z' }
    this.membershipError = this.homeError = null
    this.furniture.clear(); this.placedCounts.clear()
    this.furnitureError = this.countError = null
    this.placements = []; this.roomError = null
    this.channels.clear()
    this.nextId = 1
  },
  emit(session: any) {
    this.session = session
    for (const listener of this.listeners) listener('TEST_EVENT', session)
  },
  emitRealtime(table: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: any) {
    for (const channel of this.channels) for (const binding of channel.bindings) {
      if (binding.filter.table !== table || binding.filter.event !== eventType) continue
      const expectedHome = binding.filter.filter?.replace('home_id=eq.', '')
      if (expectedHome && row.home_id !== expectedHome) continue
      binding.callback({ eventType, new: eventType === 'DELETE' ? {} : row, old: eventType === 'DELETE' ? row : {} })
    }
  },
  emitRealtimeStatus(status: string) {
    for (const channel of this.channels) channel.statusCallback?.(status)
  },
}

export const supabase = {
  channel(name: string) {
    const channel: any = {
      name, bindings: [] as any[], statusCallback: null as any,
      on(_kind: string, filter: any, callback: any) { channel.bindings.push({ filter, callback }); return channel },
      subscribe(callback: any) { channel.statusCallback = callback; mock.channels.add(channel); queueMicrotask(() => callback('SUBSCRIBED')); return channel },
    }
    return channel
  },
  async removeChannel(channel: any) { mock.channels.delete(channel); return 'ok' },
  from(table: string) {
    const call = { table, columns: '', filter: [] as any[], filters: [] as any[], inFilters: [] as any[], operation: 'select', values: null as any, options: null as any }
    mock.queryCalls.push(call)
    const execute = () => {
      if (table === 'placed_furniture') {
        if (call.options?.head) return { data: null, count: mock.placedCounts.get(call.filters.find(([column]) => column === 'furniture_id')?.[1]) ?? 0, error: mock.countError }
        if (mock.roomError) return { data: null, error: mock.roomError }
        if (call.operation === 'insert') {
          const row = { id: `placement-${mock.nextId++}`, ...call.values }
          mock.placements.push(row); return { data: [row], error: null }
        }
        const rows = mock.placements.filter(row => call.filters.every(([column, value]) => row[column] === value))
        if (call.operation === 'update') for (const row of rows) Object.assign(row, call.values)
        if (call.operation === 'delete') mock.placements = mock.placements.filter(row => !rows.includes(row))
        return { data: rows, error: null }
      }
      if (mock.furnitureError) return { data: null, error: mock.furnitureError }
      const matches = (row: any) => call.filters.every(([column, value]) => row[column] === value) && call.inFilters.every(([column, values]) => values.includes(row[column]))
      if (call.operation === 'insert') {
        const id = `furniture-${mock.nextId++}`
        const row = { id, ...call.values, created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' }
        mock.furniture.set(id, row)
        return { data: [row], error: null }
      }
      const rows = [...mock.furniture.values()].filter(matches)
      if (call.operation === 'update') for (const row of rows) Object.assign(row, call.values, { updated_at: '2026-09-15T01:00:00Z' })
      if (call.operation === 'delete') for (const row of rows) { mock.furniture.delete(row.id); mock.placedCounts.delete(row.id) }
      return { data: rows.map(row => ({ ...row, creator: { display_name: mock.creatorNames[row.creator_id] ?? 'Ben' } })), error: null }
    }
    const query = {
      select(columns: string, options?: any) { call.columns = columns; call.options = options; return query },
      eq(column: string, value: string) { call.filter = [column, value]; call.filters.push([column, value]); return query },
      in(column: string, values: string[]) { call.inFilters.push([column, values]); return query },
      order(_column: string, _options?: any) { return query },
      insert(values: any) { call.operation = 'insert'; call.values = values; return query },
      update(values: any) { call.operation = 'update'; call.values = values; return query },
      delete() { call.operation = 'delete'; return query },
      then(resolve: any, reject: any) { return Promise.resolve(execute()).then(resolve, reject) },
      async maybeSingle() {
        if (table === 'home_members') return { data: mock.membership, error: mock.membershipError }
        const result = execute(); return { data: result.data?.[0] ?? null, error: result.error }
      },
      async single() {
        if (table === 'homes') return { data: mock.home, error: mock.homeError }
        const result = execute(); return { data: result.data?.[0] ?? null, error: result.error ?? (!result.data?.length ? { message: 'No matching row' } : null) }
      },
    }
    return query
  },
  auth: {
    async getUser() {
      return { data: { user: mock.session ? { id: 'test-user', ...mock.session.user } : null }, error: null }
    },
    onAuthStateChange(callback: (event: string, session: any) => void) {
      mock.listeners.add(callback)
      return { data: { subscription: { unsubscribe: () => mock.listeners.delete(callback) } } }
    },
    getSession() {
      if (mock.pendingRestore) return new Promise<any>((resolve) => { mock.resolveRestore = resolve })
      return Promise.resolve({ data: { session: mock.session }, error: mock.restoreError })
    },
    async signInWithPassword(credentials: any) {
      mock.loginCalls.push(credentials)
      if (mock.loginError) return { data: { session: null }, error: mock.loginError }
      const session = { user: { email: credentials.email } }
      mock.emit(session)
      return { data: { session }, error: null }
    },
    async signOut(options: any) {
      mock.logoutCalls.push(options)
      if (mock.logoutError) return { error: mock.logoutError }
      mock.emit(null)
      return { error: null }
    },
  },
}
