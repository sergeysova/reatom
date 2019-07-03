console.warn('FLAXOM still work in progress, do not use it in production')

/** TODO: remove `@ts-ignore` */

type ActionType = string
type ActionTypesDictionary = { [key in ActionType]: true }
type DependenciesDictionary = { [key in NodeId]: true }

type NodeId = string
type Node = {
  id: NodeId
  domain: string
  name: string
  actionTypes: ActionTypesDictionary
  dependencies: DependenciesDictionary
  stackWorker: (ctx: Ctx) => any
}

const NODE = Symbol('@@FLAXOM/NODE')
const defaultDomain = 'defaultDomain'
const idSeparator = ' / '

let id = 0
function generateId() {
  return ++id
}
function noop() {}

type ActionCreator<Input = void, Payload = Input> = {
  (input: Input): Action<Payload>
  getType: () => string
  [NODE]: Node
}
type Atom<T> = {
  (state: StateBasic, action: Action<any>): StateBasic
  [NODE]: Node
}

type Unit<T = unknown> = (ActionCreator<any, T>) | (Atom<T>)

function throwIf(predicate: boolean | any, msg: string) {
  // TODO: add link to docs with full description
  if (predicate) throw new Error(msg)
}

function safetyStr(str: any, name: string): string {
  throwIf(typeof str !== 'string' || str.length === 0, `Invalid ${name}`)
  return str
}
function safetyFunc(func: any, name: string): Function {
  throwIf(typeof func !== 'function', `Invalid ${name}`)
  return func
}

type StateBasic = { [key in string]: { [key in string]: any } }
type StackWorker = (ctx: Ctx) => any
type Stack = StackWorker[]
type Ctx = {
  state: StateBasic
  type: string
  payload: any
  stack: Stack
  stateNew: StateBasic
  statePlain: { [key in string]: any }
  visited: { [key in string]: true }
  isChanged: boolean
  write: (node: Node, value: any) => void
}
function createCtx(
  state: StateBasic,
  { type, payload }: Action<any>,
  stack: Stack,
): Ctx {
  return {
    state,
    type,
    payload,
    stack,
    stateNew: {},
    statePlain: {},
    visited: {},
    isChanged: false,
    write({ domain, name, id }: Node, value: any) {
      const { stateNew, statePlain } = this
      this.isChanged = true
      const domainState = state[domain]
      let domainStateNew = stateNew[domain]
      if (domainStateNew === undefined)
        domainStateNew = stateNew[domain] =
          domainState === undefined ? {} : Object.assign({}, domainState)

      domainStateNew[name] = value
      statePlain[id] = value
    },
  }
}

type Action<Payload, Type extends string = string> = {
  type: Type
  payload: Payload
}

function getIsAction(target: any) {
  return target && target[NODE] && typeof target.getType === 'function'
}

export function createActionCreator<Input = void, Payload = Input>(
  type: string | [string] = 'action',
  // @ts-ignore
  mapper: (input: Input) => Payload = input => input,
  // FIXME: any
): ActionCreator<Input, Payload> {
  type = Array.isArray(type)
    ? safetyStr(type[0], 'type')
    : `${safetyStr(type, 'type')} [${generateId()}]`

  safetyFunc(mapper, 'mapper')

  const ACActionTypes = { [type]: true as const }
  const ACNode: Node = {
    id: type,
    domain: type,
    name: type,
    actionTypes: ACActionTypes,
    dependencies: ACActionTypes,
    stackWorker: noop,
  }

  function actionCreator(
    payload?: Input,
  ): {
    type: string
    payload: Payload
  } {
    return {
      // @ts-ignore
      type,
      // @ts-ignore
      payload: mapper(payload),
    }
  }

  // @ts-ignore
  actionCreator[NODE] = ACNode
  actionCreator.getType = () => type

  // @ts-ignore
  return actionCreator
}

// initiate action
export const actionDefault = createActionCreator('@@FLAXOM/default')
const actionDefaultType = actionDefault.getType()

// @ts-ignore
export declare function createAtom<State>(
  name: string | [string, string],
  initialState: State,
  handle: (
    reduce: <T>(
      dependency: Unit<T>,
      reducer: (state: State, value: T) => State,
    ) => void,
  ) => any,
): Atom<State>
// @ts-ignore
export declare function createAtom<State>(
  initialState: State,
  handle: (
    reduce: <T>(
      dependency: Unit<T>,
      reducer: (state: State, value: T) => State,
    ) => void,
  ) => any,
): Atom<State>
export function createAtom<State>(
  name: string | [string, string],
  initialState: State,
  handle: (
    reduce: <T>(
      dependency: Unit<T>,
      reducer: (state: State, value: T) => State,
    ) => void,
  ) => any,
): Atom<State> {
  if (arguments.length === 2) {
    // @ts-ignore
    handle = initialState
    // @ts-ignore
    initialState = name
    name = 'reducer'
  }
  throwIf(initialState === undefined, "Initial state can't be undefined")

  let atomDomain: string, atomName: string, atomId: string

  if (Array.isArray(name)) {
    atomDomain = safetyStr(name[0], 'domain')
    atomName = safetyStr(name[1], 'name')
    atomId = name.join(idSeparator)
  } else {
    atomDomain = defaultDomain
    atomName = `${safetyStr(name, 'name')} [${generateId()}]`
    atomId = [atomDomain, atomName].join(idSeparator)
  }

  const atomActionTypes: ActionTypesDictionary = {}
  const atomDependencies: DependenciesDictionary = {}
  const atomStack: Stack = []
  let initialPhase = true

  function reduce<T>(
    dep: Unit<T>,
    reducer: (state: State, payload: T) => State,
  ) {
    throwIf(
      !initialPhase,
      "Can't define dependencies after atom initialization",
    )

    let depNode: Node
    throwIf(!dep || !(depNode = dep[NODE]), 'Invalid dependency')

    const {
      id: depId,
      actionTypes: depActionTypes,
      dependencies: depDependencies,
      stackWorker: depStackWorker,
    } = depNode!
    // @ts-ignore
    const isDepActionCreator = getIsAction(dep)

    throwIf(depDependencies[atomId], 'One of dependencies has the equal id')
    safetyFunc(reducer, 'reducer')

    Object.assign(atomActionTypes, depActionTypes)
    Object.assign(atomDependencies, depDependencies)
    atomDependencies[depId] = true

    function invalidateDeps(ctx: Ctx) {
      ctx.stack.push(depStackWorker)
    }
    function update(ctx: Ctx) {
      const { statePlain, state, payload, type } = ctx
      if (isDepActionCreator || statePlain[depId] !== undefined) {
        const depState = isDepActionCreator ? payload : statePlain[depId]
        let atomStateOld = statePlain[atomId]
        if (atomStateOld === undefined) {
          atomStateOld = (state[atomDomain] || {})[atomName]
        }

        const atomState = reducer(atomStateOld, depState)

        throwIf(atomState === undefined, "State can't be undefined")

        if (atomState !== atomStateOld || type === actionDefaultType) {
          // TODO: add subscribers
          ctx.write(atomNode, (statePlain[atomId] = atomState))
        }
      }
    }

    atomStack.push(ctx => {
      if (depActionTypes[ctx.type]) ctx.stack.push(update, invalidateDeps)
    })
  }

  reduce(actionDefault, (state = initialState) => state)
  handle(reduce)
  initialPhase = false

  atomStack.push((ctx: Ctx) => (ctx.visited[atomId] = true))
  atomStack.reverse()

  const atomNode: Node = {
    id: atomId,
    domain: atomDomain,
    name: atomName,
    actionTypes: atomActionTypes,
    dependencies: atomDependencies,
    stackWorker: ctx => {
      if (atomActionTypes[ctx.type] && !ctx.visited[atomId])
        ctx.stack.push(...atomStack)
    },
  }

  function atom(state: Ctx['state'], action: { type: string; payload: any }) {
    const ctx = createCtx(state, action, [atomNode.stackWorker])

    walk(ctx)

    return ctx.isChanged ? Object.assign({}, state, ctx.stateNew) : state
  }

  // @ts-ignore
  atom[NODE] = atomNode

  // @ts-ignore
  return atom
}

function getIsAtom(target: any) {
  return target && target[NODE] && !getIsAction(target)
}

export function getState<T>(state: StateBasic, atom: Atom<T>): T | undefined {
  const atomNode = atom[NODE]
  return (state[atomNode.domain] || {})[atomNode.name]
}

export function getNode(target: Unit): Node {
  return target[NODE]
}

function walk(ctx: Ctx) {
  const { stack } = ctx
  let f
  while ((f = stack.pop())) f(ctx)

  return ctx
}

// @ts-ignore
export declare function map<T, _T = unknown>(
  atom: Atom<_T>,
  mapper: (dependedAtomState: _T) => T,
): Atom<T>
// @ts-ignore
export declare function map<T, _T = unknown>(
  name: string | [string, string],
  atom: Atom<_T>,
  mapper: (dependedAtomState: _T) => T,
): Atom<T>
// @ts-ignore
export function map(name, target, mapper) {
  if (arguments.length === 2) {
    mapper = target
    target = name
    name = `${(target[NODE] as Node).name} [map]`
  }
  safetyFunc(mapper, 'mapper')

  return createAtom(
    name,
    // FIXME: initialState for `map` :thinking:
    null,
    reduce => reduce(target, (state, payload) => mapper(payload)),
  )
}

// @ts-ignore
export function combine<T extends { [key in string]: Atom<any> }>(
  shape: T,
): Atom<{ [key in keyof T]: T[key] extends Atom<infer S> ? S : never }>
export function combine<T extends { [key in string]: Atom<any> }>(
  name: string,
  shape: T,
): Atom<{ [key in keyof T]: T[key] extends Atom<infer S> ? S : never }>
export function combine<T extends { [key in string]: Atom<any> }>(
  name: string,
  shape: T,
): Atom<{ [key in keyof T]: T[key] extends Atom<infer S> ? S : never }> {
  let keys: string[]
  if (arguments.length === 1) {
    // @ts-ignore
    shape = name
    name = `{ ${(keys = Object.keys(shape)).join()} }`
  }

  keys = keys = Object.keys(shape)

  return createAtom(name, {}, reduce =>
    keys.map(key =>
      reduce(shape[key], (state, payload) =>
        Object.assign({}, state, {
          [key]: payload,
        }),
      ),
    ),
  )
}

declare function storeGetState<TargetAtom extends Atom<any>>(
  target: TargetAtom,
): TargetAtom extends Atom<infer S> ? S : never
declare function storeGetState(): StateBasic

declare function storeSubscribe<TargetAtom extends Atom<any>>(
  target: TargetAtom,
  listener: (state: TargetAtom extends Atom<infer S> ? S : never) => any,
): () => void
declare function storeSubscribe(
  listener: (state: StateBasic) => any,
): () => void
export type Store = {
  dispatch: (action: Action<any>) => void
  subscribe: typeof storeSubscribe
  getState: typeof storeGetState
}

export function createStore(atom: Atom<any>, preloadedState = {}): Store {
  const listenersStore = {} as { [key in string]: Function[] }
  const listenersActions: Function[] = []
  const atomNode = atom[NODE]
  const atomNodeDeps = atomNode.dependencies
  const depsCounter: { [key in string]: number } = {}

  const newStack: Stack = []
  let isDepsCounterActual = true
  let stack: Stack = [atomNode.stackWorker]
  let state: Ctx['state']

  for (const key in atomNodeDeps) depsCounter[key] = 1

  const ctx = createCtx(preloadedState, actionDefault(), [atomNode.stackWorker])

  walk(ctx)

  const initialStatePlain = ctx.statePlain
  state = ctx.stateNew

  function actualizeState() {
    if (newStack.length > 0) {
      const ctx = createCtx(state, actionDefault(), newStack)

      walk(ctx)

      if (ctx.isChanged) state = Object.assign({}, state, ctx.stateNew)
    }
    if (!isDepsCounterActual) {
      for (const key in depsCounter)
        if (depsCounter[key] === 0) {
          delete depsCounter[key]
          const [domain, name] = key.split(idSeparator)
          state = Object.assign({}, state)
          state[domain] = Object.assign({}, state[domain])
          delete state[domain][name]
        }
    }
  }

  function _getState(target?: Atom<any>) {
    actualizeState()

    if (target === undefined) return state

    throwIf(!getIsAtom(target), 'Invalid target')

    const targetState = getState(state, target)
    if (targetState !== undefined) return targetState

    const ctx = createCtx(state, actionDefault(), [target[NODE].stackWorker])

    walk(createCtx(state, actionDefault(), [target[NODE].stackWorker]))

    return getState(
      walk(createCtx(state, actionDefault(), [target[NODE].stackWorker]))
        .stateNew,
      target,
    )
  }

  // @ts-ignore
  function subscribe(...a) {
    let isSubscribed = true
    let listener: Function

    if (a.length === 1) {
      listener = safetyFunc(a[0], 'listener')
      listenersActions.push(listener)
      return () => {
        if (isSubscribed) {
          isSubscribed = false
          listenersActions.splice(listenersActions.indexOf(listener, 1))
        }
      }
    }

    const target = safetyFunc(a[0], 'listener')
    listener = a[1]
    let targetNode = (target as Atom<any>)[NODE]

    throwIf(!getIsAtom(target), 'Target is not Atom')

    const targetId = targetNode.id
    const targetStackWorker = targetNode.stackWorker
    const targetDeps = targetNode.dependencies
    const isLazy = initialStatePlain[targetId] === undefined

    if (listenersStore[targetId] === undefined) {
      listenersStore[targetId] = []
      if (isLazy) {
        newStack.push(targetStackWorker)
        stack.push(targetStackWorker)
        depsCounter[targetId] =
          depsCounter[targetId] === undefined ? 1 : depsCounter[targetId] + 1
        for (const key in targetDeps)
          depsCounter[key] =
            depsCounter[key] === undefined ? 1 : depsCounter[key] + 1
      }
    }

    listenersStore[targetId].push(listener)

    return () => {
      if (isSubscribed) {
        isSubscribed = false

        const _listeners = listenersStore[targetId]
        _listeners.splice(_listeners.indexOf(listener), 1)
        if (isLazy) {
          depsCounter[targetId]--
          for (const key in targetDeps) depsCounter[key]--
          isDepsCounterActual = false
          if (_listeners.length === 0) {
            stack.splice(stack.indexOf(targetStackWorker), 1)
            if (~newStack.indexOf(targetStackWorker))
              newStack.splice(newStack.indexOf(targetStackWorker), 1)
          }
        }
      }
    }
  }

  function dispatch(action: Action<any>) {
    throwIf(
      typeof action !== 'object' ||
        action === null ||
        typeof action.type !== 'string',
      'Invalid action',
    )

    actualizeState()

    const ctx = createCtx(state, action, stack.slice(0))

    walk(ctx)

    if (ctx.isChanged) {
      state = Object.assign({}, state, ctx.stateNew)

      for (const key in ctx.statePlain) {
        const listeners = listenersStore[key]
        if (listeners) {
          const atomState = ctx.statePlain[key]
          listeners.forEach(cb => cb(atomState))
        }
      }
    }

    listenersActions.forEach(cb => cb(action))
  }

  return { getState: _getState, subscribe, dispatch }
}
