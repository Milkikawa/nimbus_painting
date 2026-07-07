package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nimbus-painting/internal/app"
	"nimbus-painting/internal/config"
	"nimbus-painting/internal/model"
	"nimbus-painting/internal/store"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid configuration: %v", err)
	}

	catalog := model.NewCatalogStore(cfg.ModelCatalogPath)
	if err := catalog.LoadOrInit(); err != nil {
		log.Fatalf("model catalog init failed: %v", err)
	}

	db, err := store.Open(cfg)
	if err != nil {
		log.Fatalf("database init failed: %v", err)
	}
	defer db.Close()

	if err := db.Migrate(context.Background()); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}

	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           app.New(cfg, db, catalog).Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("nimbus painting proxy listening on %s", cfg.ListenAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
}
