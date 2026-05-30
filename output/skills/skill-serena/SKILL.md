---
id: "skill-serena"
name: Serena - Semantic Coding Agent
version: "1.0.0"
description: "语义级代码检索和编辑工具包，支持跨文件符号理解、智能重构和代码导航，比grep更精准"
category: prompt
tags: ["semantic", "code-search", "refactoring", "navigation"]
author: "Oraios"
repositoryUrl: "https://github.com/oraios/serena"
parameters:
    transport: "stdio"
    configTemplate: "{\"transport\": \"stdio\", \"command\": \"npx\", \"args\": [\"-y\", \"serena\"]}"
---

### To get started run the following (this builds in dev mode with watchers):

```
$> git clone https://gitlab.com/Inspiravetion/serena
$> cd serena
$> npm run init
$> gulp
```

### Roadmap
- Injection/AB Testing/loading story
- testing

### Stores
Source of truth for data that needs to be persisted. May not directly touch or alter data from other stores. However, middleware may access other stores so circular dependencies need to be avoided. Should be used for feature data (settings, complex navigation interactions, authentication, etc), middleware data that needs to be shared across instances and asynchronously initialized. Stores should also own all error handling and logic for how its data changes. A stores Data is readonly outside of its action methods.

### Middleware
Allow for the altering of control flow in Store/Controller actions as well as hooks to react to action and model events. Middleware may be mounted on a class so that all of it's actions/model properties are instrumented or on a 
action/model property level for more granularity. Each place a middleware is mounted, a new instance of it is created.
For instance, mounting one on a class will instantiate one instance and use it for all actions/model properties. Each action/model property that it is mounted on will get a fresh instance of the middleware. Middleware may also take dependencies on Stores.

### Controller
Map store and controller state to stateless views and wire user interactions to store actions. Controllers should also handle their loading and error states.

- Decorators
    -> @store + @controller
        => @state
        => @derived_state
        => @action
    -> @controller + @middleware
        => @store
    -> @store
        => @async (must be used with action)
- Initialization
    -> async initialize()


### Mounting Middleware and Attaching Observers

#### Directly
```typescript

const middleware = [
    () => new Interuptable(),
    () => new Atomic(),
    () => new Authenticated(),
    () => new Logging()    
];

@store()                                                         
@mount(middleware) 
class FooStore {
    ...
} 
```

#### Via Decorator Extensions
```typescript
const cooperative = middlewareDecorator([Interuptable, Atomic]);
const authenticated = middlewareDecorator([Authenticated]);

@store()                                                         
@cooperative
@authenticated
class FooStore {
    ...
} 
```