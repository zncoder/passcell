package main

import (
	"encoding/csv"
	"html"
	"html/template"
	"io"
	"log"
	"net/url"
	"os"
)

func main() {
	r := csv.NewReader(os.Stdin)
	r.Comment = '#'

	type Site struct {
		Host string
		Name string
		Pw   string
	}

	var sites []*Site
	for {
		rr, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Fatal(err)
		}

		n, p := html.UnescapeString(rr[1]), html.UnescapeString(rr[2])
		if n == "" || p == "" {
			log.Printf("ignore record:%v, no name or password", rr)
			continue
		}

		u, err := url.Parse(html.UnescapeString(rr[0]))
		if err != nil {
			log.Printf("ignore record:%v, invalid url", rr)
			continue
		}
		if u.Scheme == "" || u.Host == "" {
			log.Printf("ignore record:%v, no scheme or host", rr)
			continue
		}
		sites = append(sites, &Site{u.Host, n, p})
	}

	err := tmpl.Execute(os.Stdout, sites)
	if err != nil {
		log.Fatal(err)
	}
}

var tmpl = template.Must(template.New("page").Parse(`<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="content-type" content="text/html; charset=UTF-8">
    <meta charset="utf-8">
  </head>
  <body>
   <table>
     {{range .}}<tr><td>{{.Host}}</td><td>{{.Name}}</td><td>{{.Pw}}</td></tr>
     {{end}}
   </table>
  </body>
</html>
`))
