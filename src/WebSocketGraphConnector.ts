import { GunGraphConnector } from './GunGraphConnector'
import { generateMessageId } from './generateMessageId'
import { GunEvent } from './GunEvent'

const PING = 60000

export class WebSocketGraphConnector extends GunGraphConnector {
  url: string
  isConnected: boolean

  events: {
    msgIn: GunEvent<GunMsg, string>
    msgOut: GunEvent<GunMsg, string>
    connected: GunEvent
    disconnected: GunEvent
  }

  private _ws: WebSocket
  private _requests: { [msgId: string]: string }
  private _requestsBySoul: { [soul: string]: string }
  private _puts: { [msgId: string]: GunEvent }
  private _queuedMessages: GunMsg[]

  constructor(url: string, WS = WebSocket) {
    super()
    this._queuedMessages = []
    this.events = {
      connected: new GunEvent(`connected ${url}`),
      disconnected: new GunEvent(`disconnected ${url}`),
      msgIn: new GunEvent(`msgIn ${url}`),
      msgOut: new GunEvent(`msgOn ${url}`)
    }
    this.isConnected = false
    this.url = url
    this._requests = {}
    this._requestsBySoul = {}
    this._puts = {}
    this._ws = new WS(this.url.replace(/^http/, 'ws'))
    this._ws.addEventListener('message', this._onReceiveSocketData.bind(this))
    this._ws.addEventListener('open', this.onSocketConnect.bind(this))
  }

  private onSocketConnect() {
    console.log('websocket connected')
    this.isConnected = true
    setInterval(() => this._ws.send('[]'), PING)
    this._send(this._queuedMessages)
    this._queuedMessages = []
  }

  request(souls: string[]) {
    const msgs: GunMsg[] = []

    for (let i = 0; i < souls.length; i++) {
      const soul = souls[i]
      if (soul in this._requestsBySoul) continue
      const msgId = generateMessageId()

      this._requests[msgId] = soul
      this._requestsBySoul[soul] = msgId
      msgs.push({
        '#': msgId,
        get: {
          '#': soul
        }
      })
    }

    this._send(msgs)
  }

  put(data: GunGraphData, ackEvt?: GunEvent) {
    const msgId = generateMessageId()
    if (ackEvt) this._puts[msgId] = ackEvt

    this._send([
      {
        '#': msgId,
        put: data
      }
    ])
  }

  private _send(msgs: GunMsg[]) {
    if (!this.isConnected) {
      this._queuedMessages.splice(0, 0, ...msgs)
      return
    }

    if (!msgs.length) return
    if (msgs.length === 1) {
      this._ws.send(JSON.stringify(msgs[0]))
    } else if (msgs.length > 0) {
      this._ws.send(JSON.stringify(msgs))
    }

    msgs.forEach(msg => this.events.msgOut.trigger(msg, this.url))
  }

  private _onReceiveMessage(msg: GunMsg) {
    if (!msg) return
    this.events.msgIn.trigger(msg, this.url)
    const respondingTo = msg['@']
    const putEvt = respondingTo && this._puts[respondingTo]
    if (putEvt) {
      putEvt.trigger(msg)
      return
    }
    if (!('put' in msg)) return
    const requestedSoul = respondingTo && this._requests[respondingTo]

    if (msg.put) {
      this.graphData.trigger(msg.put)
    } else if (requestedSoul) {
      this.graphData.trigger({
        [requestedSoul]: undefined
      })
    }
  }

  private _onReceiveSocketData(msg: any) {
    const raw = msg.data || msg
    const json = JSON.parse(raw)
    if (Array.isArray(json)) {
      json.forEach(this._onReceiveMessage.bind(this))
    } else {
      this._onReceiveMessage(json)
    }
  }
}
