import fs from 'fs'
import glob from 'glob-promise'
import { execSync } from 'child_process'
import path from 'path'
const __dirname = path.resolve()
import PQueue from 'p-queue'
import dateFormat from "dateformat/lib/dateformat.js"
import Fastify from 'fastify'
import fastify_io from 'fastify-socket.io'
import puppeteer from 'puppeteer'
import md5File from 'md5-file'
import xml2js from 'xml2js'
import lineReader from 'line-reader'
import archiver from 'archiver'
const { parseString } = xml2js
import { Readable, PassThrough } from 'stream'
import { PrismaClient } from '@prisma/client'

const user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.54 Safari/537.36"

const chrome_flags = [
  "--ignore-certificate-errors",
  "--disable-default-apps",
  "--disable-background-networking",
  "--disable-breakpad",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-renderer-backgrounding",
  "--disable-hang-monitor",
  "--disable-popup-blocking",
]

const fastify = Fastify({
  logger: false,
  bodyLimit: 19922944
})

fastify.register(fastify_io, {})

const reportDir = path.join(__dirname, 'report')
const dbPath = path.join(reportDir, 'snapback.db')

// Create the report directory if it doesn't exist
if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir)
}

// Check if the database file exists
const dbExists = fs.existsSync(dbPath)

// Initialize Prisma client
const prisma = new PrismaClient()

async function initializeDatabase() {
  if (!dbExists) {
    console.log('Initializing database...')
    try {
      // Run Prisma migration
      execSync('npx prisma migrate deploy', { stdio: 'inherit' })
      console.log('Database initialized successfully.')
    } catch (error) {
      console.error('Error initializing database:', error)
      process.exit(1)
    }
  }
}

let bruteforce_modules = [];

async function loadModules() {
  try {
    const files = await glob('./bruteforce/*.js');
    files.forEach((file) => {
      let module_file = path.basename(file);
      bruteforce_modules.push(module_file);
    });
  } catch (er) {
    console.error("Error occurred while loading files: ", er);
  }
}

loadModules();

fastify.route({
  method: ['GET'],
  url: '/',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/homepage.html")
    await reply.type('text/html').send(stream)
  }
})

fastify.route({
  method: ['GET'],
  url: '/jquery.min.js',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/node_modules/jquery/dist/jquery.min.js")
    await reply.type('text/javascript').send(stream)
  }
})

fastify.route({
  method: ['GET'],
  url: '/favicon.ico',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/favicon.ico")
    await reply.type('image/x-icon').send(stream)
  }
})

fastify.route({
  method: ['GET'],
  url: '/report/*',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/report/" + req.params['*'])
    await reply.type('image/png').send(stream)
  }
})

fastify.route({
  method: ['GET'],
  url: '/all_services',
  handler: async function (req, reply) {
    const all_services = await prisma.service.findMany({
      where: {
        OR: [
          { captured: 1 },
          { error: 1 }
        ]
      }
    })
    await reply.type('application/json').send(all_services)
  }
})

fastify.route({
  method: ['GET'],
  url: '/auth_prompts',
  handler: async function (req, reply) {
    const all_services = await prisma.service.findMany({
      where: { authPrompt: 1 }
    })
    await reply.type('application/json').send(all_services)
  }
})

fastify.route({
  method: ['GET'],
  url: '/unviewed_services',
  handler: async function (req, reply) {
    const all_services = await prisma.service.findMany({
      where: {
        viewed: 0,
        error: 0
      }
    })
    await reply.type('application/json').send(all_services)
  }
})

fastify.route({
  method: ['GET'],
  url: '/notes_services',
  handler: async function (req, reply) {
    const all_services = await prisma.service.findMany({
      where: {
        OR: [
          { notes: { not: '' } },
          { defaultCreds: { not: '' } }
        ]
      }
    })
    await reply.type('application/json').send(all_services)
  }
})

fastify.route({
  method: ['GET'],
  url: '/report',
  handler: async function (req, reply) {
    var archive = archiver('zip')
    let fileOutput = new PassThrough()
    archive.pipe(fileOutput)
    archive.on('error', function (err) {
      throw err
    })
    archive.file('./report/snapback.db', { name: 'snapback.db' })
    console.log('zipping:snapback.db')
    fastify.io.emit('server_message', 'zipping:snapback.db')
    const rows = await prisma.service.findMany({
      where: {
        OR: [
          { defaultCreds: { not: '' } },
          { authPrompt: 1 }
        ]
      }
    })
    for (const row of rows) {
      let file_name = row.imagePath.split('/')[1]
      console.log('zipping:' + file_name)
      fastify.io.emit('server_message', 'zipping:' + file_name)
      await archive.file('./' + row.imagePath, { name: file_name })
    }
    archive.finalize()
    await reply.type('application/zip').send(fileOutput)
    fileOutput.close()
  }
})

fastify.route({
  method: ['GET'],
  url: '/export',
  handler: async function (req, reply) {
    let fileOutput = new Readable({
      read() { }
    })
    fileOutput.push(`"url","imagePath","imageHash","textPath","textHash","textSize","captured","error","viewed","defaultCreds","authPrompt","notes"\n`)
    const full_db = await prisma.service.findMany()
    full_db.forEach(function (row) {
      fileOutput.push(`"${row.url}","${row.imagePath}","${row.imageHash}","${row.textPath}","${row.textHash}","${row.textSize}","${row.captured}","${row.error}","${row.viewed}","${row.defaultCreds}","${row.authPrompt}","${row.notes}"\n`)
    })
    fileOutput.push(null)
    await reply.type('text/csv').send(fileOutput)
    fileOutput.close()
  }
})

fastify.route({
  method: ['GET'],
  url: '/search',
  schema: {
    querystring: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'HTML Title'
        },
        header: {
          type: 'string',
          description: 'server header search'
        },
        metatag: {
          type: 'string',
          description: 'search for metatag data'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'array'
      }
    }
  },
  handler: async function (req, reply) {
    const all_services = await prisma.service.findMany({
      where: {
        AND: [
          { title: { contains: req.query['title'] } },
          { headers: { contains: req.query['header'] } },
          { metaTags: { contains: req.query['metatag'] } }
        ]
      }
    })
    await reply.type('application/json').send(all_services)
  }
})

fastify.route({
  method: ['POST'],
  url: '/generate_bruteforce_module',
  schema: {
    body: {
      type: 'object',
      properties: {
        service_name: {
          type: 'string',
          description: 'service description'
        },
        template: {
          type: 'string',
          description: 'type of auth template'
        },
        url: {
          type: 'string',
          description: 'url to base template off of'
        }
      }
    }
  },
  handler: async function (req, reply) {
    try {
      const service = await prisma.service.findUnique({
        where: { url: req.body.url }
      })

      if (!service) {
        return reply.status(404).send('Service not found')
      }

      const data = await fs.promises.readFile(`./templates/post_auth.js`, 'utf-8')

      let processedData = data
        .replace('TITLE', service.title)
        .replace('HEADERS', JSON.stringify(service.headers))
        .replace('METATAGS', JSON.stringify(service.metaTags))

      let newFileName = req.body.service_name.toLowerCase().replace(/[\.\/:\?\&=]+/g, "_")
      let newFilePath = `./bruteforce/${service.numTags}_${newFileName}.js`

      let resolvePromise
      const myPromise = new Promise((resolve, reject) => {
        resolvePromise = resolve
      })

      let puppet_options = [
        "--ignore-certificate-errors",
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
        "--no-sandbox",
      ]
      const browser = await puppeteer.launch({
        headless: false,
        ignoreHTTPSErrors: true,
        ignoreDefaultArgs: ["--enable-automation"],
        defaultViewport: null,
        args: puppet_options
      })
      const pages = await browser.pages()
      const page = pages[0]

      page.on('response', async response => {
        try {
          const request = response.request()
          const method = request.method()
          if (method === 'POST' || method === 'PUT') {
            const req_body = request.postData()
            if (req_body.includes('user123') || req_body.includes('password123')) {
              console.log(`POST request to ${response.url()} with body: ${req_body}`)
              let req_headers = request.headers()
              delete req_headers['cookie']
              delete req_headers['user-agent']
              delete req_headers['origin']
              delete req_headers['referer']
              delete req_headers['location']
              console.log(`Request headers: ${JSON.stringify(req_headers)}`)
              const url = response.url()
              const status = response.status()
              const headers = response.headers()
              console.log(`${status} ${JSON.stringify(headers)}`)
              processedData = processedData.replace('URL_PLACEHOLDER', url.replace(/.*\/\/[^\/]+/, ''))
              processedData = processedData.replace('STATUS_PLACEHOLDER', status)
              processedData = processedData.replace('HEADERS_PLACEHOLDER', JSON.stringify(req_headers))
              processedData = processedData.replace('BODY_PLACEHOLDER', req_body).replace(/user123/g, '${user}').replace(/password123/g, '${pwd}')
              await fs.promises.writeFile(newFilePath, processedData)
              await browser.close()
              resolvePromise()
              return reply.type('text').send(`Template module written to ${service.numTags}_${newFileName}.js, go finish it!`)
            }
          }
        } catch (err) {
          resolvePromise()
          return reply.type('text').send(`Error generating module! Try copying over the template yourself`)
        }
      })

      await page.goto(service.url, { waitUntil: 'networkidle0' })

      await page.evaluate(async () => {
        alert('Enter user123 and password123 to generate a login attempt. We\'ll capture and template the request for you.')
      })

      await myPromise
      console.log(`Template module written to ${service.numTags}_${newFileName}.js, go finish it!`)

    } catch (err) {
      console.error(err)
      return reply.status(500).send('Internal Server Error')
    }
  }
})

var allServices = []

async function update_record(url, key, value, callback) {
  try {
    await prisma.service.update({
      where: { url: url },
      data: { [key]: value }
    })
    if ((typeof callback) != 'undefined') {
      callback()
    }
  } catch (error) {
    console.error(`Error updating record: ${error}`)
  }
}

async function bruteforce(service, io, proxy) {
  let similar_services = bruteforce_modules.filter(async function (module) {
    let module_tag_num = parseInt(module.match(/^\d+/)[0])
    let variation = Math.abs(service.numTags - module_tag_num)
    return (variation < 25)
  })
  for (let module of similar_services) {
    let brute_module = await import(`./bruteforce/${module}`)
    let match = await brute_module.match_fingerprint(service, proxy)
    if (match) {
      await prisma.service.update({
        where: { url: service.url },
        data: { notes: match }
      })
      io.emit('server_message', `Matched Fingerprint For: ${match}`)
      io.emit('update_service', { "service": service.url, "field": "url_notes", "value": match })
      let creds = await brute_module.bruteforce(service, proxy)
      if (creds) {
        await prisma.service.update({
          where: { url: service.url },
          data: { defaultCreds: creds }
        })
        io.emit('update_service', { "service": service.url, "field": "defaultCreds", "value": creds })
        io.emit('server_message', `Found Creds: ${creds}`)
      }
    }
  }
}

async function display_service(url, io, proxy) {
  const row = await prisma.service.findUnique({
    where: { url: url }
  })
  io.emit('add_service', row)
  bruteforce(row, io, proxy)
}

const queue = new PQueue({ concurrency: 10 })

var xml_buffer = ''
var add_to_buffer = false

function parseReportHost(xml, browser, io, timeout, proxy) {
  parseString(xml, function (err, report_host) {
    let host = report_host.ReportHost.$.name
    let report_items = report_host.ReportHost.ReportItem
    try {
      report_items.forEach(function (item) {
        parseReportItem(host, item, browser, io, timeout, proxy)
      })
    } catch (err) {
      //host must not have any findings
      //console.log(err)
    }
  })
}

function parseReportItem(host, item, browser, io, timeout, proxy) {
  let plugin_id = item.$.pluginID
  let service = item.$.svc_name
  let port = item.$.port
  if (((port == '443') || (port == '8443')) || (service.includes("https")) || (service.includes("ssl")) || (service.includes("tls"))) {
    push_to_queue("https://" + host + ":" + port, browser, io, timeout, proxy)
  } else if (plugin_id == '22964') {
    if (item.plugin_output.toString().match(/TLS|SSL/i)) {
      push_to_queue("https://" + host + ":" + port, browser, io, timeout, proxy)
    } else {
      push_to_queue("http://" + host + ":" + port, browser, io, timeout, proxy)
    }
  } else if ((service.includes("www")) || (service.includes("http"))) {
    push_to_queue("http://" + host + ":" + port, browser, io, timeout, proxy)
  }
}

function parseNmapHost(xml, browser, io, timeout, proxy) {
  parseString(xml, function (err, report_host) {
    let addresses = report_host.host.address
    let host = ""
    try {
      Object.keys(addresses).forEach(function (key) {
        if (addresses[key].$.addrtype == "ipv4") {
          host = addresses[key].$.addr
        }
      })
    } catch (err) {
      //host must not have any findings
      return
    }
    let report_items = report_host.host.ports
    try {
      Object.keys(report_items).forEach(function (key) {
        parseNmapPort(host, report_items[key], browser, io, timeout, proxy)
      })
    } catch (err) {
      //host must not have any findings
    }
  })
}

function parseNmapPort(host, item, browser, io, timeout, proxy) {
  let services = item.port
  try {
    Object.keys(services).forEach(function (key) {
      if (services[key].state[0].$.state == "open") {
        if (services[key].service[0].$.name.match(/https/ig)) {
          push_to_queue("https://" + host + ":" + services[key].$.portid, browser, io, timeout, proxy)
        } else if (services[key].service[0].$.name.match(/http/ig)) {
          push_to_queue("http://" + host + ":" + services[key].$.portid, browser, io, timeout, proxy)
        } else if (services[key].service[0].$.name.match(/ssl/ig)) {
          push_to_queue("https://" + host + ":" + services[key].$.portid, browser, io, timeout, proxy)
        }
      }
    })
  } catch (err) {
    //host must not have any findings
  }
}

async function getPic(url, browser, io, timeout, proxy) {
  try {
    let page = await browser.newPage()
    await page.setUserAgent(user_agent)
    await page.setViewport({ width: 1000, height: 500 })
    page.on('dialog', async dialog => {
      await dialog.dismiss()
    })
    let myTimeout = new Promise((resolve, reject) => setTimeout(resolve, (timeout * 1000)))
    let navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: (timeout * 1000) }).catch(async function (err) { return })
    let response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: (timeout * 1000) }).catch(async function (err) {
      console.log(err)
      try {
        await page.close()
      } catch (err) {
        console.log(err)
      }
      throw new Error(`Error On URL: ${url}`)
    })
    await Promise.race([navigationPromise, myTimeout])
    await update_record(url, "headers", JSON.stringify(response.headers()))
    let file_name = url.replace(/[\.\/:\?\&=]+/g, "_")
    await Promise.race([page.screenshot({ path: 'report/' + file_name + '.png' }), new Promise((resolve, reject) => setTimeout(reject, 30000))]).catch(async function (err) {
      console.log(err)
      try {
        await page.close()
      } catch (err) {
        console.log(err)
      }
      throw new Error('Screenshot Failed')
    })
    await update_record(url, "imagePath", 'report/' + file_name + '.png')
    let meta_tags = await page.evaluate('var meta = {};var metatags=document.getElementsByTagName("meta");for(var izz=0;izz<metatags.length;izz++){let name=metatags[izz].getAttribute("name");let property=metatags[izz].getAttribute("property");let content=metatags[izz].getAttribute("content");if(content!=undefined){if(property != undefined){meta[property] = content;}else if(name != ""){meta[name] = content;}}};JSON.stringify(meta);')
    await update_record(url, "metaTags", meta_tags)
    let title = await page.evaluate('document.title')
    await update_record(url, "title", title)
    let num_tags = await page.evaluate('document.getElementsByTagName("*").length')
    await update_record(url, "numTags", parseInt(num_tags))
    let num_a_tags = await page.evaluate('document.getElementsByTagName("a").length')
    await update_record(url, "numATags", parseInt(num_a_tags))
    let num_script_tags = await page.evaluate('document.getElementsByTagName("script").length')
    await update_record(url, "numScriptTags", parseInt(num_script_tags))
    let num_input_tags = await page.evaluate('document.getElementsByTagName("input").length')
    await update_record(url, "numInputTags", parseInt(num_input_tags))
    const hash = await md5File('report/' + file_name + '.png')
    await update_record(url, "imageHash", hash)
    let bodyHTML = await page.evaluate(() => document.documentElement.innerHTML)
    fs.writeFileSync('report/' + file_name + '.txt', bodyHTML)
    if (bodyHTML.match(/type=['"]password['"]/ig)) {
      await update_record(url, "authPrompt", 1)
    }
    await update_record(url, "textPath", 'report/' + file_name + '.txt')
    await update_record(url, "captured", 1)
    console.log("queue:[" + queue.size + "/" + allServices.length.toString() + "]threads[" + queue.pending + "] captured: " + url)
    io.emit("server_message", "queue:[" + queue.size + "/" + allServices.length.toString() + "]threads[" + queue.pending + "] captured: " + url)
    const textHash = await md5File('report/' + file_name + '.txt')
    const stats = fs.statSync('report/' + file_name + '.txt')
    await update_record(url, "textSize", stats.size)
    await update_record(url, "textHash", textHash)
    display_service(url, io, proxy)
    await update_record(url, "error", 0)
    await page.close()
  } catch (err) {
    console.log("queue:[" + queue.size + "/" + allServices.length.toString() + "]threads[" + queue.pending + "] problem capturing page: " + url)
    io.emit("server_message", "queue:[" + queue.size + "/" + allServices.length.toString() + "]threads[" + queue.pending + "] problem capturing page: " + url)
    console.log(err)
    await update_record(url, "error", 1)
    io.emit('show_error', url)
  }
}

async function push_to_queue(url, browser, io, timeout, proxy) {
  if (!allServices.includes(url)) {
    try {
      await prisma.service.create({
        data: {
          url: url,
          imagePath: '',
          imageHash: '',
          textPath: '',
          textHash: '',
          title: '',
          headers: '',
          textSize: 0,
          numTags: 0,
          numATags: 0,
          numScriptTags: 0,
          numInputTags: 0,
          metaTags: '',
          captured: 0,
          error: 0,
          viewed: 0,
          defaultCreds: '',
          authPrompt: 0,
          notes: ''
        }
      })
      queue.add(() => getPic(url, browser, io, timeout, proxy))
      allServices.push(url)
    } catch (error) {
      console.error(`Error pushing to queue: ${error}`)
    }
  }
}

async function process_file(request, io) {
  let puppet_options = [...chrome_flags]
  var timeout = request.timeout_setting

  if (request.use_proxy) {
    puppet_options.push("--proxy-server=" + request.proxy_setting)
  }

  if (process.getuid != undefined && process.getuid() == 0) {
    puppet_options.push("--no-sandbox")
  }

  const browser = await puppeteer.launch(
    {
      headless: true,
      ignoreHTTPSErrors: true,
      args: puppet_options
    }
  )

  if (request.file_path.match(/nessus$/ig)) {
    io.emit('server_message', "processing as Nessus file: " + request.file_path)
    lineReader.eachLine(request.file_path, function (line) {
      if (line.match(/<ReportHost/i)) {
        xml_buffer += line + "\n"
        add_to_buffer = true
      } else if (add_to_buffer) {
        xml_buffer += line + "\n"
        if (line.match(/<\/ReportHost/i)) {
          parseReportHost(xml_buffer, browser, io, timeout, request.proxy_setting)
          xml_buffer = ''
          add_to_buffer = false
        }
      }
    })
  } else if (request.file_path.match(/txt$/ig)) {
    io.emit('server_message', "processing as flat txt file: " + request.file_path)
    lineReader.eachLine(request.file_path, function (line) {
      push_to_queue(line, browser, io, timeout, request.proxy_setting)
    })
  } else if (request.file_path.match(/js$|json/ig)) {
    io.emit('server_message', "processing as ScopeCreep export file: " + request.file_path)
    var full_file = fs.readFileSync(request.file_path, "utf8")
    var report_object = JSON.parse(full_file)
    for (var i = 0; i < report_object.nodes.length; i++) {
      let current_node = report_object.nodes[i]
      if (current_node.type == "subdomain") {
        push_to_queue("http://" + current_node.id, browser, io, timeout, request.proxy_setting)
        push_to_queue("https://" + current_node.id, browser, io, timeout, request.proxy_setting)
      } else if (current_node.type == "port") {
        if (current_node.id.split(":")[1].match(/443/)) {
          push_to_queue("https://" + current_node.id, browser, io, timeout, request.proxy_setting)
        } else {
          push_to_queue("http://" + current_node.id, browser, io, timeout, request.proxy_setting)
        }
      } else if (current_node.type == "network") {
        push_to_queue("http://" + current_node.id, browser, io, timeout, request.proxy_setting)
      } else if (current_node.type == "info") {
        if (current_node.id.match(/https?:\/\/.+/)) {
          let url_regex = new RegExp('(https?://.+)', 'i')
          let url_string = url_regex.exec(current_node.id)[1]
          push_to_queue(url_string, browser, io, timeout, request.proxy_setting)
        }
      }
    }
  } else if (request.file_path.match(/xml$/ig)) {
    io.emit('server_message', "processing as Nmap file: " + request.file_path)
    lineReader.eachLine(request.file_path, function (line) {
      if (line.match(/<host /i)) {
        xml_buffer += line + "\n"
        add_to_buffer = true
      } else if (add_to_buffer) {
        xml_buffer += line + "\n"
        if (line.match(/<\/host>/i)) {
          parseNmapHost(xml_buffer, browser, io, timeout, request.proxy_setting)
          xml_buffer = ''
          add_to_buffer = false
        }
      }
    })
  } else {
    io.emit('server_message', "Snapback currently only supports .nessus, flat .txt url files, .xml nmap files, and ScopeCreep exports. Try again...")
    await browser.close()
    return
  }
  setTimeout(async function () {
    await queue.onIdle()
    browser.close()
    fastify.io.emit("server_message", "Done!")
  }, 10000)
}

async function resume_scan(new_queue, request, io) {
  if (new_queue.length == 0) {
    io.emit('server_message', "Nothing to do!")
    return
  }

  io.emit('server_message', "processing unfinished queue from DB")

  var timeout = parseInt(request.timeout_setting)
  let puppet_options = [...chrome_flags]

  if (request.use_proxy) {
    puppet_options.push("--proxy-server=" + request.proxy_setting)
  }

  if (process.getuid != undefined && process.getuid() == 0) {
    puppet_options.push("--no-sandbox")
  }

  const browser = await puppeteer.launch(
    {
      headless: true,
      ignoreHTTPSErrors: true,
      args: puppet_options
    }
  )

  for (let url of new_queue) {
    queue.add(() => getPic(url, browser, io, timeout, request.proxy_setting))
  }

  setTimeout(async function () {
    await queue.onIdle()
    browser.close()
    fastify.io.emit("server_message", "Done!")
  }, 10000)
}







fastify.ready(async function (err) {
  if (err) throw err
  fastify.io.on('connect', function (socket) {
    console.info('Socket connected!', socket.id)
    socket.on('process_file', async function (request) {
      process_file(request, fastify.io)
    })
    socket.on('update_record', function (request) {
      update_record(request.url, request.key, request.value)
    })
    socket.on('pause_scan', function () {
      queue.clear()
    })
    socket.on('resume_scan', async function (request) {
      const new_queue = await prisma.service.findMany({
        where: {
          captured: 0,
          error: 0
        },
        select: { url: true }
      })
      resume_scan(new_queue.map(service => service.url), request, fastify.io)
    })
    socket.on('scan_errors', async function (request) {
      const new_queue = await prisma.service.findMany({
        where: { error: 1 },
        select: { url: true }
      })
      resume_scan(new_queue.map(service => service.url), request, fastify.io)
    })
    socket.on('csv_export', async function (request) {
      let fileOutput = fs.createWriteStream('./' + request.csv_name);
      fileOutput.write(`"url","imagePath","imageHash","textPath","textHash","textSize","captured","error","viewed","defaultCreds","authPrompt","notes"\n`)
      const full_db = await prisma.service.findMany()
      full_db.forEach(function (row) {
        fileOutput.write(`"${row.url}","${row.imagePath}","${row.imageHash}","${row.textPath}","${row.textHash}","${row.textSize}","${row.captured}","${row.error}","${row.viewed}","${row.defaultCreds}","${row.authPrompt}","${row.notes}"\n`)
      })
      fileOutput.close()
      fastify.io.emit("server_message", "Exported to: ./" + request.csv_name)
    })
    socket.on('report_export', async function (request) {
      var archive = archiver('zip')
      let fileOutput = fs.createWriteStream('./' + request.zip_name)
      fileOutput.on('close', function () {
        console.log(archive.pointer() + ' total bytes')
        console.log('Report Export saved to: ' + request.zip_name)
        fastify.io.emit('server_message', 'Report Export saved to: ' + request.zip_name)
      })
      archive.pipe(fileOutput)
      archive.on('error', function (err) {
        throw err
      })
      archive.file('./report/snapback.db', { name: 'snapback.db' })
      const rows = await prisma.service.findMany({
        where: {
          OR: [
            { defaultCreds: { not: '' } },
            { authPrompt: 1 }
          ]
        }
      })
      rows.forEach(function (row) {
        console.log(row.imagePath)
        let file_name = row.imagePath.split('/')[1]
        console.log(file_name)
        archive.file('./' + row.imagePath, { name: file_name })
      })
      archive.finalize()
    })
  })
})

// Initialize the database before starting the server
initializeDatabase().then(() => {
  // Start your Fastify server here
  fastify.listen({ port: 2997, host: '0.0.0.0' })
    .then((address) => console.log(`server listening on ${address}`))
    .catch(err => {
      console.log(`Error starting server: ${err}`)
      process.exit(1)
    })
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Gracefully shutting down')
  await prisma.$disconnect()
  process.exit(0)
})
