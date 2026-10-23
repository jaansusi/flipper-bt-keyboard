CC ?= cc
CFLAGS ?= -std=c11 -Wall -Wextra -Werror -O1 -g -fsanitize=address,undefined

SRC_DIR := ../remote_keyboard

test_rk_report: test_rk_report.c $(SRC_DIR)/rk_report.c $(SRC_DIR)/rk_report.h
	$(CC) $(CFLAGS) -o $@ test_rk_report.c $(SRC_DIR)/rk_report.c

.PHONY: test clean
test: test_rk_report
	./test_rk_report

clean:
	rm -f test_rk_report
